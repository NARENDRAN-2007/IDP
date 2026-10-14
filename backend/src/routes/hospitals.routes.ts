import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { db } from '../db/index.js';
import { BedReservationService } from '../services/bedReservationService.js';
import { authenticateJWT, requireHospitalStaff, requireHospitalScope } from '../middleware/authMiddleware.js';
import { validateBody, validateParams } from '../middleware/validate.js';
import { AppError, NotFoundError } from '../errors/AppError.js';
import { haversineDistanceKm } from '../modules/distance.js';
import { realtimeHub } from '../realtime/socket.js';
import { DoctorRosterService } from '../services/doctorRosterService.js';

export const hospitalsRouter = Router();

// Hospital routes require hospital_staff role and isolation to their assigned hospital_id
hospitalsRouter.use('/:id', authenticateJWT, requireHospitalStaff, requireHospitalScope('id'));

const hospitalParamsSchema = z.object({
  id: z.string().min(1)
});

const hospitalPatientParamsSchema = z.object({
  id: z.string().min(1),
  reqId: z.string().min(1)
});

const updateBedsSchema = z.object({
  bedType: z.enum(['ER', 'ICU', 'General']),
  total: z.number().int().min(0).optional(),
  available: z.number().int().min(0).optional(),
  delta: z.number().int().optional()
});

const updateDoctorsSchema = z.object({
  specialty: z.enum(['general', 'cardiac', 'neuro', 'obstetric']),
  count: z.number().int().min(0),
  shift_start: z.string().optional(),
  shift_end: z.string().optional()
});

const rejectRequestSchema = z.object({
  reason: z.string().min(1, 'Reject reason is mandatory').max(500)
});

/**
 * GET /api/hospitals/:id/incoming
 * Fetches all incoming provisional and accepted patients (Plan 7.4, 9.3)
 */
hospitalsRouter.get(
  '/:id/incoming',
  validateParams(hospitalParamsSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const hospitalId = req.params.id;

      // Hospital location for ETA calculation
      const hospRes = await db.query('SELECT lat, lng FROM hospitals WHERE id = $1', [hospitalId]);
      if (hospRes.rows.length === 0) throw new NotFoundError('Hospital not found');
      const hospLoc = hospRes.rows[0];

      // Active requests assigned or provisionally held for this hospital
      const query = `
        SELECT r.id, r.patient_user_id, r.created_at, r.lat, r.lng, r.location_source,
               r.status, r.symptoms_text, r.severity_level, r.required_specialty, r.bed_type,
               r.assigned_ambulance_id, r.provisional_hospital_id, r.confirmed_hospital_id,
               r.active_hold_id, r.cascade_count,
               r.allocated_doctor_id, r.allocated_doctor_name, r.allocated_doctor_specialty, r.allocated_doctor_room,
               h.id as hold_id, h.expires_at as hold_expires_at, h.status as hold_status,
               a.plate as amb_plate, a.lat as amb_lat, a.lng as amb_lng, a.last_seen as amb_last_seen, a.status as amb_status
        FROM requests r
        LEFT JOIN bed_holds h ON r.active_hold_id = h.id
        LEFT JOIN ambulances a ON r.assigned_ambulance_id = a.id
        WHERE (r.provisional_hospital_id = $1 OR r.confirmed_hospital_id = $1)
        ORDER BY r.created_at DESC
      `;

      const reqsRes = await db.query(query, [hospitalId]);
      const now = Date.now();

      const activeRows = reqsRes.rows.filter(
        (row) => !['COMPLETED', 'CANCELLED', 'NO_HOSPITAL_AVAILABLE'].includes(row.status)
      );

      const incomingPatients = await Promise.all(
        activeRows.map(async (row) => {
          // Fetch latest vitals reading for this request
          const vitalsRes = await db.query(
            `SELECT hr, spo2, valid, ts
             FROM vitals_readings
             WHERE request_id = $1
             ORDER BY ts DESC
             LIMIT 1`,
            [row.id]
          );

          // Fetch latest location ping
          const locationRes = await db.query(
            `SELECT lat, lng, speed, stale, ts
             FROM location_pings
             WHERE request_id = $1
             ORDER BY ts DESC
             LIMIT 1`,
            [row.id]
          );

          const vitals = vitalsRes.rows[0] || null;
          const ping = locationRes.rows[0] || null;

          const currentAmbLat = ping?.lat ?? row.amb_lat ?? row.lat;
          const currentAmbLng = ping?.lng ?? row.amb_lng ?? row.lng;

          // Compute ETA in minutes (avg 40 km/h in metro)
          const distKm = haversineDistanceKm(currentAmbLat, currentAmbLng, hospLoc.lat, hospLoc.lng);
          const etaMinutes = Math.max(1, Math.round((distKm / 35) * 60));

          // Check staleness (Plan 11.4: GPS stale > 60s, vitals stale > 30s)
          const lastLocTime = ping?.ts ? new Date(ping.ts).getTime() : (row.amb_last_seen ? new Date(row.amb_last_seen).getTime() : now);
          const isLocationStale = now - lastLocTime > 60000;

          const lastVitalsTime = vitals?.ts ? new Date(vitals.ts).getTime() : 0;
          const isVitalsStale = lastVitalsTime > 0 ? now - lastVitalsTime > 30000 : true;

          const doc = row.allocated_doctor_name
            ? {
                id: row.allocated_doctor_id,
                name: row.allocated_doctor_name,
                specialty: row.allocated_doctor_specialty,
                room: row.allocated_doctor_room
              }
            : DoctorRosterService.allocateDoctorForSpecialty(hospitalId, row.required_specialty || 'general');

          return {
            requestId: row.id,
            status: row.status,
            patientLocation: { lat: row.lat, lng: row.lng },
            severityLevel: row.severity_level || 3,
            symptomsText: row.symptoms_text || 'Emergency distress reported',
            requiredSpecialty: row.required_specialty || 'general',
            bedType: row.bed_type || 'ER',
            allocatedDoctor: doc,
            holdStatus: row.hold_status === 'pending'
              ? 'HOLD_PENDING'
              : (row.hold_status === 'confirmed'
                ? 'CONFIRMED'
                : (row.status === 'HOLD_PENDING' ? 'HOLD_PENDING' : (row.status === 'HOSPITAL_ACCEPTED' ? 'CONFIRMED' : row.status))),
            holdExpiresAt: row.hold_expires_at,
            isConfirmed: row.status === 'HOSPITAL_ACCEPTED' || row.hold_status === 'confirmed',
            hold: row.hold_id
              ? {
                  holdId: row.hold_id,
                  expiresAt: row.hold_expires_at,
                  status: row.hold_status === 'pending' ? 'HOLD_PENDING' : (row.hold_status === 'confirmed' ? 'CONFIRMED' : row.hold_status),
                  remainingSeconds: Math.max(0, Math.round((new Date(row.hold_expires_at).getTime() - now) / 1000))
                }
              : null,
            ambulance: row.assigned_ambulance_id
              ? {
                  id: row.assigned_ambulance_id,
                  plate: row.amb_plate,
                  status: row.amb_status,
                  lat: currentAmbLat,
                  lng: currentAmbLng,
                  speed: ping?.speed || 40,
                  isStale: isLocationStale,
                  isConfirmed: row.status === 'HOSPITAL_ACCEPTED' || row.hold_status === 'confirmed'
                }
              : null,
            vitals: vitals
              ? {
                  hr: vitals.hr,
                  spo2: vitals.spo2,
                  valid: vitals.valid,
                  ts: vitals.ts,
                  isStale: isVitalsStale,
                  disclaimer: 'non-clinical / demo-grade'
                }
              : null,
            etaMinutes,
            distanceKm: parseFloat(distKm.toFixed(2)),
            cascadeCount: row.cascade_count || 0,
            createdAt: row.created_at
          };
        })
      );

      // Fetch hospital bed counts
      const bedsRes = await db.query(
        `SELECT bed_type, total, available, updated_at
         FROM hospital_beds
         WHERE hospital_id = $1`,
        [hospitalId]
      );

      const bedsMap: Record<string, { total: number; available: number; updatedAt: string }> = {};
      bedsRes.rows.forEach((b) => {
        bedsMap[b.bed_type] = {
          total: b.total,
          available: b.available,
          updatedAt: b.updated_at
        };
      });

      // Fetch doctors on duty and enrich with named staff, specialty types, and timeslots
      const docsRes = await db.query(
        `SELECT specialty, count, shift_start, shift_end
         FROM doctors_on_duty
         WHERE hospital_id = $1`,
        [hospitalId]
      );

      const { doctorsOnDuty: enrichedDocs, allDoctors } = DoctorRosterService.getEnrichedDoctorsOnDuty(
        hospitalId,
        docsRes.rows
      );

      return res.status(200).json({
        ok: true,
        data: {
          hospitalId,
          incomingPatients,
          beds: bedsMap,
          doctorsOnDuty: enrichedDocs,
          doctors: allDoctors
        },
        error: null
      });
    } catch (err: any) {
      console.error('INCOMING ENDPOINT ERROR:', err);
      next(err);
    }
  }
);

/**
 * PATCH /api/hospitals/:id/beds
 * Updates ER, ICU, or General bed counts (+ / - controls on dashboard, Plan 7.4)
 */
hospitalsRouter.patch(
  '/:id/beds',
  validateParams(hospitalParamsSchema),
  validateBody(updateBedsSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const hospitalId = req.params.id;
      const { bedType, total, available, delta } = req.body;

      const updated = await db.withTransaction(async (client) => {
        const currentRes = await client.query(
          `SELECT total, available
           FROM hospital_beds
           WHERE hospital_id = $1 AND bed_type = $2
           FOR UPDATE`,
          [hospitalId, bedType]
        );

        if (currentRes.rows.length === 0) {
          throw new NotFoundError(`Bed type ${bedType} not configured for hospital ${hospitalId}`);
        }

        const current = currentRes.rows[0];
        let newTotal = total !== undefined ? total : current.total;
        let newAvailable = available !== undefined ? available : current.available;

        if (delta !== undefined) {
          newAvailable = Math.max(0, current.available + delta);
        }

        if (newAvailable > newTotal) {
          newTotal = newAvailable; // expand total if available exceeds total
        }

        const updateRes = await client.query(
          `UPDATE hospital_beds
           SET total = $1,
               available = $2,
               updated_at = NOW(),
               updated_by = $3
           WHERE hospital_id = $4 AND bed_type = $5
           RETURNING hospital_id, bed_type, total, available, updated_at`,
          [newTotal, newAvailable, req.user?.id || 'staff', hospitalId, bedType]
        );

        // Record audit access log
        await client.query(
          `INSERT INTO audit_access_log (user_id, entity, entity_id, action, ts)
           VALUES ($1, 'hospital_beds', $2, $3, NOW())`,
          [
            req.user?.id || 'staff',
            hospitalId,
            `BED_UPDATE_${bedType}_AVAIL_${newAvailable}_TOTAL_${newTotal}`
          ]
        );

        return updateRes.rows[0];
      });

      // Emit realtime beds.updated (Plan 8.2)
      realtimeHub.emitBedsUpdated(hospitalId, {
        bedType: updated.bed_type,
        total: updated.total,
        available: updated.available
      });

      return res.status(200).json({
        ok: true,
        data: {
          hospitalId: updated.hospital_id,
          bedType: updated.bed_type,
          total: updated.total,
          available: updated.available,
          updatedAt: updated.updated_at
        },
        error: null
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * PATCH /api/hospitals/:id/doctors
 * Updates on-duty doctor counts (informational only, Plan 6.1, 7.4)
 */
hospitalsRouter.patch(
  '/:id/doctors',
  validateParams(hospitalParamsSchema),
  validateBody(updateDoctorsSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const hospitalId = req.params.id;
      const { specialty, count, shift_start = '08:00', shift_end = '20:00' } = req.body;

      const docId = `DOC_${hospitalId}_${specialty.toUpperCase()}`;
      const result = await db.query(
        `INSERT INTO doctors_on_duty (id, hospital_id, specialty, count, shift_start, shift_end)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (id) DO UPDATE SET
           count = EXCLUDED.count,
           shift_start = EXCLUDED.shift_start,
           shift_end = EXCLUDED.shift_end
         RETURNING id, hospital_id, specialty, count, shift_start, shift_end`,
        [docId, hospitalId, specialty, count, shift_start, shift_end]
      );

      return res.status(200).json({
        ok: true,
        data: result.rows[0],
        error: null
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/hospitals/:id/incoming/:reqId/accept
 * Staff accepts incoming patient (confirms hold, Plan 7.4, 9.3)
 */
hospitalsRouter.post(
  '/:id/incoming/:reqId/accept',
  validateParams(hospitalPatientParamsSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id: hospitalId, reqId } = req.params;
      const hold = await BedReservationService.confirmReservation(reqId, hospitalId);

      return res.status(200).json({
        ok: true,
        data: {
          requestId: reqId,
          hospitalId,
          holdId: hold.id,
          bedType: (hold as any).bedType,
          status: 'HOSPITAL_ACCEPTED',
          allocatedDoctor: (hold as any).allocatedDoctor,
          updatedBedAvailable: (hold as any).updatedBedAvailable,
          message: `Patient bed confirmed. Allocated Doctor: ${(hold as any).allocatedDoctor?.name || 'On-Duty Specialist'}`
        },
        error: null
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/hospitals/:id/incoming/:reqId/reject
 * Staff rejects patient with mandatory reason (triggers cascade, Plan 7.4, 9.3)
 */
hospitalsRouter.post(
  '/:id/incoming/:reqId/reject',
  validateParams(hospitalPatientParamsSchema),
  validateBody(rejectRequestSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id: hospitalId, reqId } = req.params;
      const { reason } = req.body;

      const cascadeResult = await BedReservationService.rejectReservation(reqId, hospitalId, reason);

      return res.status(200).json({
        ok: true,
        data: {
          requestId: reqId,
          hospitalId,
          status: 'HOSPITAL_REJECTED',
          cascaded: cascadeResult.cascaded,
          nextHospitalId: cascadeResult.nextHospitalId || null,
          message: 'Patient rejected; automated cascade triggered'
        },
        error: null
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/hospitals/:id/incoming/:reqId/arrived
 * Staff clicks "Patient arrived" handover button (closes request, consumes bed, Plan 5.8, 7.4)
 */
hospitalsRouter.post(
  '/:id/incoming/:reqId/arrived',
  validateParams(hospitalPatientParamsSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id: hospitalId, reqId } = req.params;
      await BedReservationService.markPatientArrived(reqId, hospitalId);

      return res.status(200).json({
        ok: true,
        data: {
          requestId: reqId,
          hospitalId,
          status: 'COMPLETED',
          message: 'Patient handover completed; ambulance returned to free'
        },
        error: null
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/hospitals/:id/history
 * Fetches past patients and outcomes for this hospital (Plan 9.3)
 */
hospitalsRouter.get(
  '/:id/history',
  validateParams(hospitalParamsSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const hospitalId = req.params.id;
      const query = `
        SELECT r.id, r.patient_user_id, r.created_at, r.completed_at, r.status, r.symptoms_text,
               r.severity_level, r.required_specialty, r.bed_type, r.assigned_ambulance_id,
               r.allocated_doctor_id, r.allocated_doctor_name, r.allocated_doctor_specialty, r.allocated_doctor_room
        FROM requests r
        WHERE (r.confirmed_hospital_id = $1 OR r.provisional_hospital_id = $1)
        ORDER BY r.created_at DESC
        LIMIT 50
      `;

      const result = await db.query(query, [hospitalId]);

      const history = result.rows.map((row) => {
        const doc = row.allocated_doctor_name
          ? {
              id: row.allocated_doctor_id,
              name: row.allocated_doctor_name,
              specialty: row.allocated_doctor_specialty,
              room: row.allocated_doctor_room
            }
          : DoctorRosterService.allocateDoctorForSpecialty(hospitalId, row.required_specialty || 'general');

        return {
          id: row.id,
          patient_id: row.patient_user_id || `P-${row.id.slice(-6).toUpperCase()}`,
          status: row.status,
          severity_level: row.severity_level || 3,
          required_specialty: row.required_specialty || 'general',
          bed_type: row.bed_type || 'ER',
          chief_complaint: row.symptoms_text || 'Emergency admission triage',
          symptoms_text: row.symptoms_text || 'Emergency admission triage',
          arrival_time: row.completed_at || row.created_at,
          completed_at: row.completed_at,
          created_at: row.created_at,
          doctor_name: doc.name,
          doctor_specialty: doc.specialty,
          doctor_room: doc.room,
          allocatedDoctor: doc
        };
      });

      return res.status(200).json({
        ok: true,
        data: {
          hospitalId,
          history
        },
        error: null
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/hospitals/:id/audit-trail
 * Fetches audit trail of status logs for this hospital (e.g. QUEUE_PRIORITIZED, Plan 9.3)
 */
hospitalsRouter.get(
  '/:id/audit-trail',
  validateParams(hospitalParamsSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const hospitalId = req.params.id;
      const query = `
        SELECT l.id, l.request_id, l.status, l.at, l.meta
        FROM request_status_log l
        WHERE l.meta->>'hospitalId' = $1
           OR l.request_id IN (
             SELECT id FROM requests WHERE provisional_hospital_id = $1 OR confirmed_hospital_id = $1
           )
        ORDER BY l.at DESC
        LIMIT 100
      `;

      const result = await db.query(query, [hospitalId]);

      return res.status(200).json({
        ok: true,
        data: {
          hospitalId,
          auditLogs: result.rows
        },
        error: null
      });
    } catch (err) {
      next(err);
    }
  }
);
