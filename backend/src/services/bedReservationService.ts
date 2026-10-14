import { db } from '../db/index.js';
import { holdTimerQueue } from '../jobs/holdTimerQueue.js';
import { AppError, NotFoundError } from '../errors/AppError.js';
import { logger } from '../utils/logger.js';
import { rematchWithSeverity, HospitalCandidate } from '../modules/hospitalMatcher.js';
import { realtimeHub } from '../realtime/socket.js';
import { DoctorRosterService } from './doctorRosterService.js';

export const HOLD_TIMEOUT_MS = 30000;
export const MAX_CASCADES = 5;

export interface BedHoldRecord {
  id: string;
  requestId: string;
  hospitalId: string;
  bedType: 'ER' | 'ICU' | 'General';
  createdAt: Date;
  expiresAt: Date;
  status: 'pending' | 'confirmed' | 'expired' | 'consumed' | 'released';
}

export class BedReservationService {
  /**
   * Initializes the hold worker handler and runs boot recovery
   */
  public static async init(): Promise<void> {
    holdTimerQueue.setHandler(async ({ holdId }) => {
      logger.info({ holdId }, 'Worker executing hold timeout verification');
      await BedReservationService.releaseAndCascade(holdId, 'TIMEOUT');
    });

    await holdTimerQueue.init();
    await BedReservationService.recoverPendingHoldsOnBoot();
  }

  /**
   * Recovers pending holds on server boot (Plan 5.3a, 5.7).
   * PostgreSQL is the single source of truth:
   * - Expire overdue holds.
   * - Re-arm BullMQ / delayed timer triggers for remaining active holds.
   */
  public static async recoverPendingHoldsOnBoot(): Promise<void> {
    logger.info('Running boot recovery for pending bed holds...');
    const result = await db.query(
      `SELECT id, request_id, hospital_id, bed_type, expires_at, status
       FROM bed_holds
       WHERE status = 'pending'`
    );

    const now = Date.now();
    for (const row of result.rows) {
      const expiresAtMs = new Date(row.expires_at).getTime();
      if (expiresAtMs <= now) {
        logger.info({ holdId: row.id }, 'Expiring overdue hold detected on boot');
        await BedReservationService.releaseAndCascade(row.id, 'TIMEOUT');
      } else {
        const remainingDelay = expiresAtMs - now;
        logger.info({ holdId: row.id, remainingMs: remainingDelay }, 'Re-arming timer for pending hold on boot');
        await holdTimerQueue.scheduleHoldTimer(row.id, row.request_id, remainingDelay);
      }
    }
  }

  /**
   * Places an atomic provisional hold on a bed (Plan 5.3a, 5.6).
   * Executes inside a PostgreSQL transaction using SELECT ... FOR UPDATE.
   */
  public static async reserveBedProvisional(
    hospitalId: string,
    bedType: 'ER' | 'ICU' | 'General',
    requestId: string
  ): Promise<BedHoldRecord> {
    const holdId = `HOLD_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const expiresAt = new Date(Date.now() + HOLD_TIMEOUT_MS);

    const holdRecord = await db.withTransaction(async (client) => {
      // 1. Lock the bed inventory row
      const bedRes = await client.query(
        `SELECT total, available
         FROM hospital_beds
         WHERE hospital_id = $1 AND bed_type = $2
         FOR UPDATE`,
        [hospitalId, bedType]
      );

      if (bedRes.rows.length === 0 || bedRes.rows[0].available <= 0) {
        throw new AppError(
          `No ${bedType} bed available at hospital ${hospitalId}`,
          409,
          'NO_HOSPITAL_AVAILABLE'
        );
      }

      // 2. Check if request currently has an active pending hold, release it atomically
      const reqRes = await client.query(
        `SELECT active_hold_id FROM requests WHERE id = $1 FOR UPDATE`,
        [requestId]
      );

      if (reqRes.rows.length > 0 && reqRes.rows[0].active_hold_id) {
        const prevHoldId = reqRes.rows[0].active_hold_id;
        const prevHoldRes = await client.query(
          `SELECT hospital_id, bed_type, status FROM bed_holds WHERE id = $1 FOR UPDATE`,
          [prevHoldId]
        );

        if (prevHoldRes.rows.length > 0 && prevHoldRes.rows[0].status === 'pending') {
          // Release previous hold and restore its bed
          await client.query(
            `UPDATE bed_holds SET status = 'released' WHERE id = $1`,
            [prevHoldId]
          );
          await client.query(
            `UPDATE hospital_beds
             SET available = available + 1, updated_at = NOW()
             WHERE hospital_id = $1 AND bed_type = $2`,
            [prevHoldRes.rows[0].hospital_id, prevHoldRes.rows[0].bed_type]
          );
        }
      }

      // 3. Decrement available bed count
      await client.query(
        `UPDATE hospital_beds
         SET available = available - 1, updated_at = NOW()
         WHERE hospital_id = $1 AND bed_type = $2`,
        [hospitalId, bedType]
      );

      // 4. Create hold record
      await client.query(
        `INSERT INTO bed_holds (id, request_id, hospital_id, bed_type, created_at, expires_at, status)
         VALUES ($1, $2, $3, $4, NOW(), $5, 'pending')`,
        [holdId, requestId, hospitalId, bedType, expiresAt]
      );

      // 5. Update request
      await client.query(
        `UPDATE requests
         SET active_hold_id = $1,
             provisional_hospital_id = $2,
             bed_type = $3,
             status = 'BED_HELD'
         WHERE id = $4`,
        [holdId, hospitalId, bedType, requestId]
      );

      // 6. Log status
      await client.query(
        `INSERT INTO request_status_log (request_id, status, at, meta)
         VALUES ($1, 'BED_HELD', NOW(), $2)`,
        [requestId, JSON.stringify({ holdId, hospitalId, bedType, expiresAt: expiresAt.toISOString() })]
      );

      return {
        id: holdId,
        requestId,
        hospitalId,
        bedType,
        createdAt: new Date(),
        expiresAt,
        status: 'pending' as const
      };
    });

    // 7. Schedule delayed timer trigger (scheduling trigger only, Plan 5.3a)
    await holdTimerQueue.scheduleHoldTimer(holdId, requestId, HOLD_TIMEOUT_MS);

    // Emit realtime events (Plan 8.2)
    realtimeHub.emitHoldCreated(hospitalId, {
      requestId,
      holdId,
      expiresAt: expiresAt.toISOString(),
      bedType
    });
    realtimeHub.emitHospitalProvisional(hospitalId, {
      requestId,
      holdId,
      expiresAt: expiresAt.toISOString(),
      bedType
    });

    logger.info({ holdId, hospitalId, requestId }, 'Atomic provisional bed hold created');
    return holdRecord;
  }

  /**
   * Confirms a provisional hold (Hospital staff clicks "Accept", Plan 7.4).
   */
  public static async confirmReservation(requestId: string, hospitalId: string): Promise<BedHoldRecord> {
    return await db.withTransaction(async (client) => {
      // 1. Lock the request
      const reqRes = await client.query(
        `SELECT id, active_hold_id, provisional_hospital_id, required_specialty FROM requests WHERE id = $1 FOR UPDATE`,
        [requestId]
      );

      if (reqRes.rows.length === 0) {
        throw new NotFoundError(`Emergency request ${requestId} not found`);
      }

      const activeHoldId = reqRes.rows[0].active_hold_id;
      if (!activeHoldId) {
        throw new AppError('No active hold found for request', 400, 'NO_ACTIVE_HOLD');
      }

      // 2. Lock the hold record
      const holdRes = await client.query(
        `SELECT id, request_id, hospital_id, bed_type, created_at, expires_at, status
         FROM bed_holds
         WHERE id = $1 FOR UPDATE`,
        [activeHoldId]
      );

      if (holdRes.rows.length === 0) {
        throw new AppError('Hold record not found', 404, 'NOT_FOUND');
      }

      const hold = holdRes.rows[0];

      if (hold.hospital_id !== hospitalId) {
        throw new AppError('Hold does not belong to this hospital', 403, 'FORBIDDEN');
      }

      if (hold.status !== 'pending') {
        throw new AppError(
          `Hold is ${hold.status} and cannot be confirmed`,
          400,
          'HOLD_EXPIRED_OR_INVALID'
        );
      }

      // 3. Allocate specialized doctor for this request
      const requiredSpec = reqRes.rows[0].required_specialty || 'general';
      const doctor = DoctorRosterService.allocateDoctorForSpecialty(hospitalId, requiredSpec);

      // 4. Mark hold confirmed
      await client.query(
        `UPDATE bed_holds SET status = 'confirmed' WHERE id = $1`,
        [activeHoldId]
      );

      // 5. Decrement bed count in hospital inventory
      const bedUpdateRes = await client.query(
        `UPDATE hospital_beds
         SET available = GREATEST(0, available - 1),
             updated_at = NOW()
         WHERE hospital_id = $1 AND bed_type = $2
         RETURNING total, available`,
        [hospitalId, hold.bed_type]
      );

      // 6. Update request status AND allocated doctor
      await client.query(
        `UPDATE requests
         SET confirmed_hospital_id = $1,
             status = 'HOSPITAL_ACCEPTED',
             allocated_doctor_id = $3,
             allocated_doctor_name = $4,
             allocated_doctor_specialty = $5,
             allocated_doctor_room = $6
         WHERE id = $2`,
        [hospitalId, requestId, doctor.id, doctor.name, doctor.specialty, doctor.room]
      );

      // 7. Log audit trail with allocated doctor
      await client.query(
        `INSERT INTO request_status_log (request_id, status, at, meta)
         VALUES ($1, 'HOSPITAL_ACCEPTED', NOW(), $2)`,
        [requestId, JSON.stringify({ holdId: activeHoldId, hospitalId, doctorName: doctor.name })]
      );

      await client.query(
        `INSERT INTO request_status_log (request_id, status, at, meta)
         VALUES ($1, 'BED_CONFIRMED', NOW(), $2)`,
        [requestId, JSON.stringify({ holdId: activeHoldId, hospitalId, doctorName: doctor.name })]
      );

      logger.info(
        { holdId: activeHoldId, hospitalId, requestId, doctorName: doctor.name },
        'Bed hold confirmed, bed count decremented, and doctor allocated'
      );

      // Emit realtime bed.confirmed
      realtimeHub.emitBedConfirmed(hospitalId, {
        requestId,
        holdId: activeHoldId
      });

      // Emit realtime beds.updated to sync decreased bed count across all dashboards
      if (bedUpdateRes.rows.length > 0) {
        realtimeHub.emitBedsUpdated(hospitalId, {
          bedType: hold.bed_type,
          available: bedUpdateRes.rows[0].available,
          total: bedUpdateRes.rows[0].total
        });
      }

      return {
        id: hold.id,
        requestId: hold.request_id,
        hospitalId: hold.hospital_id,
        bedType: hold.bed_type,
        createdAt: hold.created_at,
        expiresAt: hold.expires_at,
        status: 'confirmed',
        allocatedDoctor: doctor,
        updatedBedAvailable: bedUpdateRes.rows[0]?.available
      } as any;
    });
  }

  /**
   * Releases a bed hold and cascades to next hospital (Plan 5.3a, 5.4, 5.7).
   * Crucial rule: If the hold is NOT pending (e.g., already confirmed or released), this is a NO-OP.
   */
  public static async releaseAndCascade(
    holdId: string,
    reason: 'TIMEOUT' | 'REJECTED' = 'TIMEOUT',
    rejectReason?: string
  ): Promise<{ cascaded: boolean; nextHospitalId?: string }> {
    let shouldCascade = false;
    let targetRequestId = '';
    let bedType: 'ER' | 'ICU' | 'General' = 'ER';
    let cascadeCount = 0;

    await db.withTransaction(async (client) => {
      // 1. Lock the hold
      const holdRes = await client.query(
        `SELECT id, request_id, hospital_id, bed_type, status
         FROM bed_holds
         WHERE id = $1 FOR UPDATE`,
        [holdId]
      );

      if (holdRes.rows.length === 0) {
        logger.warn({ holdId }, 'Hold record not found in releaseAndCascade');
        return;
      }

      const hold = holdRes.rows[0];

      // CRITICAL CHECK: If already confirmed or released, NO-OP!
      if (hold.status !== 'pending') {
        logger.info(
          { holdId, status: hold.status },
          'Hold timer fired but hold is not pending — NO-OP'
        );
        return;
      }

      targetRequestId = hold.request_id;
      bedType = hold.bed_type;

      // 2. Mark hold expired or released
      const newStatus = reason === 'REJECTED' ? 'released' : 'expired';
      await client.query(
        `UPDATE bed_holds SET status = $1 WHERE id = $2`,
        [newStatus, holdId]
      );

      // 3. Restore bed capacity for this hospital
      await client.query(
        `UPDATE hospital_beds
         SET available = available + 1, updated_at = NOW()
         WHERE hospital_id = $1 AND bed_type = $2`,
        [hold.hospital_id, hold.bed_type]
      );

      // 4. Lock and update request if this hold is active
      const reqRes = await client.query(
        `SELECT id, active_hold_id, cascade_count, status
         FROM requests
         WHERE id = $1 FOR UPDATE`,
        [targetRequestId]
      );

      if (reqRes.rows.length === 0) return;
      const req = reqRes.rows[0];

      if (req.active_hold_id === holdId) {
        cascadeCount = (req.cascade_count || 0) + 1;
        const statusTransition = reason === 'REJECTED' ? 'HOSPITAL_REJECTED' : 'BED_HOLD_TIMED_OUT';

        await client.query(
          `UPDATE requests
           SET active_hold_id = NULL,
               cascade_count = $1,
               status = $2
           WHERE id = $3`,
          [cascadeCount, statusTransition, targetRequestId]
        );

        await client.query(
          `INSERT INTO request_status_log (request_id, status, at, meta)
           VALUES ($1, $2, NOW(), $3)`,
          [
            targetRequestId,
            statusTransition,
            JSON.stringify({
              holdId,
              hospitalId: hold.hospital_id,
              reason: rejectReason || reason,
              cascadeCount
            })
          ]
        );

        shouldCascade = true;
      }
    });

    if (!shouldCascade || !targetRequestId) {
      return { cascaded: false };
    }

    // 5. Execute Cascade loop outside the initial transaction
    return await BedReservationService.cascadeToNextCandidate(targetRequestId, bedType, cascadeCount);
  }

  /**
   * Finds the next best hospital candidate and reserves a bed (max 5 cascades).
   */
  private static async cascadeToNextCandidate(
    requestId: string,
    bedType: 'ER' | 'ICU' | 'General',
    cascadeCount: number
  ): Promise<{ cascaded: boolean; nextHospitalId?: string }> {
    if (cascadeCount > MAX_CASCADES) {
      logger.warn({ requestId, cascadeCount }, 'Cascade limit reached; marking NO_HOSPITAL_AVAILABLE');
      await db.query(
        `UPDATE requests SET status = 'NO_HOSPITAL_AVAILABLE' WHERE id = $1`,
        [requestId]
      );
      await db.query(
        `INSERT INTO request_status_log (request_id, status, at, meta)
         VALUES ($1, 'NO_HOSPITAL_AVAILABLE', NOW(), $2)`,
        [requestId, JSON.stringify({ reason: 'MAX_CASCADES_EXCEEDED' })]
      );
      return { cascaded: false };
    }

    // Fetch request details
    const reqRes = await db.query(
      `SELECT id, lat, lng, required_specialty, location_source FROM requests WHERE id = $1`,
      [requestId]
    );

    if (reqRes.rows.length === 0) return { cascaded: false };
    const req = reqRes.rows[0];

    // Fetch all hospitals
    const hospRes = await db.query(
      `SELECT id, name, lat, lng, specialties, empanelled FROM hospitals`
    );

    // Fetch beds
    const bedsRes = await db.query(
      `SELECT hospital_id, bed_type, total, available FROM hospital_beds`
    );

    const bedsByHospital: Record<string, any> = {};
    for (const b of bedsRes.rows) {
      if (!bedsByHospital[b.hospital_id]) bedsByHospital[b.hospital_id] = {};
      bedsByHospital[b.hospital_id][b.bed_type] = { total: b.total, available: b.available };
    }

    // Fetch already tried hospitals for this request
    const triedRes = await db.query(
      `SELECT DISTINCT hospital_id FROM bed_holds WHERE request_id = $1`,
      [requestId]
    );
    const triedHospitalIds = new Set(triedRes.rows.map((r) => r.hospital_id));

    const candidates: HospitalCandidate[] = hospRes.rows.map((r) => ({
      id: r.id,
      name: r.name,
      lat: r.lat,
      lng: r.lng,
      specialties: r.specialties,
      empanelled: r.empanelled,
      beds: bedsByHospital[r.id] || {}
    }));

    // Re-rank candidates using Option A radius-loop ranking (Plan 5.4)
    const ranked = rematchWithSeverity(
      { lat: req.lat, lng: req.lng },
      req.required_specialty || 'general',
      bedType,
      candidates,
      req.location_source || 'gps'
    );

    const nextCandidate = ranked.find((c) => !triedHospitalIds.has(c.id));

    if (!nextCandidate) {
      logger.warn({ requestId }, 'No further hospital candidates available');
      await db.query(
        `UPDATE requests SET status = 'NO_HOSPITAL_AVAILABLE' WHERE id = $1`,
        [requestId]
      );
      await db.query(
        `INSERT INTO request_status_log (request_id, status, at, meta)
         VALUES ($1, 'NO_HOSPITAL_AVAILABLE', NOW(), $2)`,
        [requestId, JSON.stringify({ reason: 'NO_CANDIDATES_REMAINING' })]
      );
      return { cascaded: false };
    }

    try {
      await BedReservationService.reserveBedProvisional(nextCandidate.id, bedType, requestId);
      logger.info({ requestId, nextHospitalId: nextCandidate.id, cascadeCount }, 'Cascaded to next hospital');
      return { cascaded: true, nextHospitalId: nextCandidate.id };
    } catch (err: any) {
      logger.warn({ err: err.message, nextHospitalId: nextCandidate.id }, 'Candidate reservation failed during cascade');
      // Recurse to try next candidate
      return await BedReservationService.cascadeToNextCandidate(requestId, bedType, cascadeCount + 1);
    }
  }

  /**
   * Rejects an incoming request (Hospital staff clicks "Reject", Plan 7.4).
   * Mandatory reason is required and logged in the audit trail.
   */
  public static async rejectReservation(
    requestId: string,
    hospitalId: string,
    reason: string
  ): Promise<{ cascaded: boolean; nextHospitalId?: string }> {
    if (!reason || reason.trim() === '') {
      throw new AppError('Reject reason is required', 400, 'VALIDATION_ERROR');
    }

    const reqRes = await db.query(
      `SELECT id, active_hold_id FROM requests WHERE id = $1`,
      [requestId]
    );

    if (reqRes.rows.length === 0) {
      throw new NotFoundError(`Emergency request ${requestId} not found`);
    }

    const activeHoldId = reqRes.rows[0].active_hold_id;
    if (!activeHoldId) {
      throw new AppError('No active hold found for request to reject', 400, 'NO_ACTIVE_HOLD');
    }

    return await BedReservationService.releaseAndCascade(activeHoldId, 'REJECTED', reason);
  }

  /**
   * Marks patient arrival and completes handover (Hospital staff clicks "Patient arrived", Plan 5.8, 7.4).
   */
  public static async markPatientArrived(requestId: string, hospitalId: string): Promise<void> {
    await db.withTransaction(async (client) => {
      // 1. Lock the request
      const reqRes = await client.query(
        `SELECT id, assigned_ambulance_id, confirmed_hospital_id, provisional_hospital_id, active_hold_id, status, required_specialty, allocated_doctor_name
         FROM requests
         WHERE id = $1 FOR UPDATE`,
        [requestId]
      );

      if (reqRes.rows.length === 0) {
        throw new NotFoundError(`Emergency request ${requestId} not found`);
      }

      const req = reqRes.rows[0];

      // If already completed, exit gracefully
      if (req.status === 'COMPLETED') {
        return;
      }

      const doctor = DoctorRosterService.allocateDoctorForSpecialty(hospitalId, req.required_specialty || 'general');

      // If patient arrived and hold was still provisional for this hospital, auto-confirm
      if (req.confirmed_hospital_id !== hospitalId) {
        if (req.provisional_hospital_id === hospitalId) {
          await client.query(
            `UPDATE requests
             SET confirmed_hospital_id = $1,
                 allocated_doctor_id = COALESCE(allocated_doctor_id, $3),
                 allocated_doctor_name = COALESCE(allocated_doctor_name, $4),
                 allocated_doctor_specialty = COALESCE(allocated_doctor_specialty, $5),
                 allocated_doctor_room = COALESCE(allocated_doctor_room, $6)
             WHERE id = $2`,
            [hospitalId, requestId, doctor.id, doctor.name, doctor.specialty, doctor.room]
          );
        } else {
          throw new AppError(
            `Request is not confirmed for hospital ${hospitalId}`,
            400,
            'FORBIDDEN'
          );
        }
      } else if (!req.allocated_doctor_name) {
        await client.query(
          `UPDATE requests
           SET allocated_doctor_id = $1,
               allocated_doctor_name = $2,
               allocated_doctor_specialty = $3,
               allocated_doctor_room = $4
           WHERE id = $5`,
          [doctor.id, doctor.name, doctor.specialty, doctor.room, requestId]
        );
      }

      // 2. Mark hold consumed
      if (req.active_hold_id) {
        await client.query(
          `UPDATE bed_holds SET status = 'consumed' WHERE id = $1`,
          [req.active_hold_id]
        );
      } else {
        await client.query(
          `UPDATE bed_holds SET status = 'consumed'
           WHERE request_id = $1 AND hospital_id = $2 AND status IN ('confirmed', 'pending')`,
          [requestId, hospitalId]
        );
      }

      // 3. Mark request completed
      await client.query(
        `UPDATE requests
         SET status = 'COMPLETED',
             completed_at = NOW()
         WHERE id = $1`,
        [requestId]
      );

      // 4. Free the ambulance
      if (req.assigned_ambulance_id) {
        await client.query(
          `UPDATE ambulances
           SET status = 'free',
               current_request_id = NULL
           WHERE id = $1`,
          [req.assigned_ambulance_id]
        );
      }

      // 5. Audit logs
      await client.query(
        `INSERT INTO request_status_log (request_id, status, at, meta)
         VALUES ($1, 'ARRIVED_AT_HOSPITAL', NOW(), $2)`,
        [requestId, JSON.stringify({ hospitalId })]
      );

      await client.query(
        `INSERT INTO request_status_log (request_id, status, at, meta)
         VALUES ($1, 'COMPLETED', NOW(), $2)`,
        [requestId, JSON.stringify({ hospitalId, completedAt: new Date().toISOString() })]
      );

      logger.info({ requestId, hospitalId }, 'Patient arrived; request completed and ambulance freed');
    });

    // Emit realtime request.completed (Plan 8.2)
    realtimeHub.emitRequestCompleted(hospitalId, {
      requestId,
      completedAt: new Date().toISOString()
    });
  }
}
