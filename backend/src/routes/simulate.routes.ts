import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { db } from '../db/index.js';
import { config } from '../config/env.js';
import { AppError, ForbiddenError } from '../errors/AppError.js';
import { BedReservationService } from '../services/bedReservationService.js';
import { classifySeverity } from '../modules/severityClassifier.js';
import { provisionalMatch, HospitalCandidate } from '../modules/hospitalMatcher.js';
import { findNearestFreeAmbulance } from '../modules/ambulanceAllocator.js';
import { realtimeHub } from '../realtime/socket.js';
import { validateBody } from '../middleware/validate.js';
import { seedDatabase } from '../db/seed.js';

export const simulateRouter = Router();

// Guarded by environment check: non-production only (Plan 7.7, 13)
simulateRouter.use((_req: Request, _res: Response, next: NextFunction) => {
  if (config.nodeEnv === 'production') {
    return next(new ForbiddenError('Simulation endpoints are disabled in production'));
  }
  next();
});

const simulateLoadSchema = z.object({
  count: z.number().int().min(1).max(20).optional().default(1),
  symptomsText: z.string().optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
  targetHospitalId: z.string().optional()
});

const simulateGpsSchema = z.object({
  ambulanceId: z.string().min(1),
  requestId: z.string().optional(),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  speed: z.number().optional().default(45)
});

const simulateVitalsSchema = z.object({
  requestId: z.string().min(1),
  ambulanceId: z.string().optional(),
  hr: z.number().int().min(30).max(250),
  spo2: z.number().int().min(50).max(100),
  valid: z.boolean().optional().default(true)
});

/**
 * POST /api/simulate/load
 * Simulates N concurrent SOS emergency requests (stands in for deferred Patient UI, Plan 4.7, 7.7)
 */
simulateRouter.post(
  '/load',
  validateBody(simulateLoadSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { count, symptomsText = 'Patient experiencing acute chest pain and shortness of breath', lat = 13.060, lng = 80.250, targetHospitalId } = req.body;

      // Classify symptoms
      const classification = classifySeverity(symptomsText);

      // Fetch free ambulances
      const ambRes = await db.query("SELECT id, plate, lat, lng, status FROM ambulances WHERE status = 'free'");
      const freeAmbulances = ambRes.rows;

      // Fetch hospitals and beds
      const hospRes = await db.query(
        `SELECT id, name, lat, lng, specialties, empanelled FROM hospitals`
      );
      const bedsRes = await db.query(
        `SELECT hospital_id, bed_type, total, available FROM hospital_beds`
      );

      const bedsByHospital: Record<string, any> = {};
      for (const b of bedsRes.rows) {
        if (!bedsByHospital[b.hospital_id]) bedsByHospital[b.hospital_id] = {};
        bedsByHospital[b.hospital_id][b.bed_type] = { total: b.total, available: b.available };
      }

      const hospitalCandidates: HospitalCandidate[] = hospRes.rows.map((r) => ({
        id: r.id,
        name: r.name,
        lat: r.lat,
        lng: r.lng,
        specialties: r.specialties,
        empanelled: r.empanelled,
        beds: bedsByHospital[r.id] || {}
      }));

      const createdRequests = [];

      for (let i = 0; i < count; i++) {
        const requestId = `REQ_SIM_${Date.now()}_${i + 1}_${Math.random().toString(36).substring(2, 6)}`;

        // Match hospital
        let matchedHospitalId = targetHospitalId;
        if (!matchedHospitalId) {
          const match = provisionalMatch({ lat, lng }, hospitalCandidates);
          matchedHospitalId = match ? match.id : 'H001';
        }

        // Allocate nearest ambulance
        let assignedAmb = null;
        if (freeAmbulances.length > 0) {
          assignedAmb = findNearestFreeAmbulance({ lat, lng }, freeAmbulances as any);
        }

        // Insert request record
        await db.query(
          `INSERT INTO requests (id, lat, lng, location_source, status, symptoms_text, severity_level, required_specialty, bed_type, assigned_ambulance_id, provisional_hospital_id, created_at)
           VALUES ($1, $2, $3, 'gps', 'TRIGGERED', $4, $5, $6, $7, $8, $9, NOW())`,
          [
            requestId,
            lat + (Math.random() - 0.5) * 0.02,
            lng + (Math.random() - 0.5) * 0.02,
            symptomsText,
            classification.level,
            classification.specialty,
            classification.bedType,
            assignedAmb ? assignedAmb.id : null,
            matchedHospitalId
          ]
        );

        if (assignedAmb) {
          await db.query(
            `UPDATE ambulances SET status = 'assigned', current_request_id = $1 WHERE id = $2`,
            [requestId, assignedAmb.id]
          );
        }

        // Place atomic bed hold
        const hold = await BedReservationService.reserveBedProvisional(
          matchedHospitalId,
          classification.bedType,
          requestId
        );

        // Initial vitals reading
        await db.query(
          `INSERT INTO vitals_readings (request_id, ambulance_id, hr, spo2, valid, ts)
           VALUES ($1, $2, $3, $4, true, NOW())`,
          [requestId, assignedAmb ? assignedAmb.id : null, 85 + Math.floor(Math.random() * 20), 96 + Math.floor(Math.random() * 4)]
        );

        // Initial location ping
        if (assignedAmb) {
          await db.query(
            `INSERT INTO location_pings (ambulance_id, request_id, lat, lng, speed, ts)
             VALUES ($1, $2, $3, $4, 45, NOW())`,
            [assignedAmb.id, requestId, assignedAmb.lat, assignedAmb.lng]
          );
        }

        // Emit realtime events to hospital room (Plan 8.2)
        realtimeHub.emitSeverityClassified(matchedHospitalId, {
          requestId,
          level: classification.level,
          specialty: classification.specialty,
          bedType: classification.bedType
        });

        createdRequests.push({
          requestId,
          hospitalId: matchedHospitalId,
          holdId: hold.id,
          bedType: classification.bedType,
          expiresAt: hold.expiresAt,
          ambulanceId: assignedAmb ? assignedAmb.id : null
        });
      }

      return res.status(201).json({
        ok: true,
        data: {
          simulatedCount: createdRequests.length,
          requests: createdRequests
        },
        error: null
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/simulate/ambulance-gps
 * Simulates ambulance GPS moving along coordinates (Plan 4.7, 7.7)
 */
simulateRouter.post(
  '/ambulance-gps',
  validateBody(simulateGpsSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { ambulanceId, requestId, lat, lng, speed = 45 } = req.body;

      // Update ambulance position
      await db.query(
        `UPDATE ambulances SET lat = $1, lng = $2, last_seen = NOW() WHERE id = $3`,
        [lat, lng, ambulanceId]
      );

      // Record location ping
      await db.query(
        `INSERT INTO location_pings (ambulance_id, request_id, lat, lng, speed, stale, ts)
         VALUES ($1, $2, $3, $4, $5, false, NOW())`,
        [ambulanceId, requestId || null, lat, lng, speed]
      );

      // Determine which hospital to notify
      let targetHospitalId = null;
      if (requestId) {
        const reqRes = await db.query(
          `SELECT provisional_hospital_id, confirmed_hospital_id FROM requests WHERE id = $1`,
          [requestId]
        );
        if (reqRes.rows.length > 0) {
          targetHospitalId = reqRes.rows[0].confirmed_hospital_id || reqRes.rows[0].provisional_hospital_id;
        }
      }

      if (targetHospitalId) {
        realtimeHub.emitAmbulanceLocation(targetHospitalId, {
          ambulanceId,
          requestId,
          lat,
          lng,
          speed,
          stale: false,
          ts: new Date().toISOString()
        });
      }

      return res.status(200).json({
        ok: true,
        data: {
          recorded: true,
          ambulanceId,
          lat,
          lng,
          speed,
          notifiedHospitalId: targetHospitalId
        },
        error: null
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/simulate/vitals
 * Simulates telemetry vitals streaming from ESP32 MAX30102 sensor (Plan 4.7, 7.7)
 */
simulateRouter.post(
  '/vitals',
  validateBody(simulateVitalsSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { requestId, ambulanceId, hr, spo2, valid = true } = req.body;

      // Record vitals in database
      await db.query(
        `INSERT INTO vitals_readings (request_id, ambulance_id, hr, spo2, valid, ts)
         VALUES ($1, $2, $3, $4, $5, NOW())`,
        [requestId, ambulanceId || null, hr, spo2, valid]
      );

      // Find assigned hospital
      const reqRes = await db.query(
        `SELECT provisional_hospital_id, confirmed_hospital_id FROM requests WHERE id = $1`,
        [requestId]
      );

      let targetHospitalId = null;
      if (reqRes.rows.length > 0) {
        targetHospitalId = reqRes.rows[0].confirmed_hospital_id || reqRes.rows[0].provisional_hospital_id;
      }

      if (targetHospitalId) {
        realtimeHub.emitVitalsUpdate(targetHospitalId, {
          requestId,
          ambulanceId,
          hr,
          spo2,
          valid,
          disclaimer: 'non-clinical / demo-grade',
          ts: new Date().toISOString()
        });
      }

      return res.status(200).json({
        ok: true,
        data: {
          recorded: true,
          requestId,
          hr,
          spo2,
          valid,
          notifiedHospitalId: targetHospitalId
        },
        error: null
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/simulate/reset
 * Resets simulation state and re-seeds hospital beds
 */
simulateRouter.post('/reset', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    await db.query("UPDATE ambulances SET current_request_id = NULL, status = 'free'");
    await db.query("UPDATE requests SET active_hold_id = NULL, assigned_ambulance_id = NULL");
    await db.query('DELETE FROM bed_holds');
    await db.query('DELETE FROM location_pings');
    await db.query('DELETE FROM vitals_readings');
    await db.query('DELETE FROM request_status_log');
    await db.query('DELETE FROM request_candidates');
    await db.query('DELETE FROM requests');

    // Re-seed data without re-running DDL migrations
    await seedDatabase(false);

    return res.status(200).json({
      ok: true,
      data: {
        message: 'Simulation environment reset to clean seed state'
      },
      error: null
    });
  } catch (err: any) {
    console.error('SIMULATE RESET ERROR:', err);
    next(err);
  }
});
