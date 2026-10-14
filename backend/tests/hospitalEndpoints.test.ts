import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { db } from '../src/db/index.js';
import { seedDatabase } from '../src/db/seed.js';
import { AuthService } from '../src/services/authService.js';
import { BedReservationService } from '../src/services/bedReservationService.js';

describe('Phase 2 Integration: Hospital REST Endpoints (Plan 7.4)', () => {
  let h001Token: string;
  let h002Token: string;

  beforeAll(async () => {
    await seedDatabase();
    await BedReservationService.init();

    const h001Login = await AuthService.loginHospitalStaff('staff_h001@hospital.er', 'Password123!');
    h001Token = h001Login.tokens.accessToken;

    const h002Login = await AuthService.loginHospitalStaff('staff_h002@hospital.er', 'Password123!');
    h002Token = h002Login.tokens.accessToken;
  });

  const setupEmergencyPatient = async (reqId: string, hospitalId = 'H001') => {
    await db.query(
      `INSERT INTO requests (id, lat, lng, required_specialty, bed_type, status, symptoms_text, severity_level, created_at)
       VALUES ($1, 13.063, 80.251, 'cardiac', 'ER', 'TRIGGERED', 'Severe chest tightness and radiation to left arm', 1, NOW())
       ON CONFLICT (id) DO UPDATE SET status = 'TRIGGERED'`,
      [reqId]
    );

    // Assign ambulance A001
    await db.query(
      `UPDATE requests SET assigned_ambulance_id = 'A001' WHERE id = $1`,
      [reqId]
    );
    await db.query(
      `UPDATE ambulances SET status = 'assigned', current_request_id = $1 WHERE id = 'A001'`,
      [reqId]
    );

    // Place provisional hold
    const hold = await BedReservationService.reserveBedProvisional(hospitalId, 'ER', reqId);
    return hold;
  };

  describe('GET /api/hospitals/:id/incoming', () => {
    it('should return incoming patients with hold remaining seconds, ETA, and vitals', async () => {
      const reqId = 'REQ_ENDPOINT_INCOMING_1';
      await setupEmergencyPatient(reqId, 'H001');

      // Add a simulated vitals reading
      await db.query(
        `INSERT INTO vitals_readings (request_id, ambulance_id, hr, spo2, valid, ts)
         VALUES ($1, 'A001', 98, 97, true, NOW())`,
        [reqId]
      );

      const res = await request(app)
        .get('/api/hospitals/H001/incoming')
        .set('Authorization', `Bearer ${h001Token}`);

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.data.hospitalId).toBe('H001');
      expect(res.body.data.incomingPatients).toBeInstanceOf(Array);

      const patient = res.body.data.incomingPatients.find((p: any) => p.requestId === reqId);
      expect(patient).toBeDefined();
      expect(patient.hold).toBeDefined();
      expect(patient.hold.remainingSeconds).toBeGreaterThan(0);
      expect(patient.vitals).toBeDefined();
      expect(patient.vitals.hr).toBe(98);
      expect(patient.vitals.disclaimer).toBe('non-clinical / demo-grade');
      expect(patient.ambulance.plate).toBeDefined();
      expect(patient.etaMinutes).toBeGreaterThan(0);

      // Beds map included in response
      expect(res.body.data.beds).toBeDefined();
      expect(res.body.data.beds.ER).toBeDefined();
    });
  });

  describe('PATCH /api/hospitals/:id/beds', () => {
    it('should allow staff to adjust available beds using delta (+/-)', async () => {
      const beforeRes = await request(app)
        .get('/api/hospitals/H001/incoming')
        .set('Authorization', `Bearer ${h001Token}`);

      const initialAvail = beforeRes.body.data.beds.General.available;

      const patchRes = await request(app)
        .patch('/api/hospitals/H001/beds')
        .set('Authorization', `Bearer ${h001Token}`)
        .send({
          bedType: 'General',
          delta: 1
        });

      expect(patchRes.status).toBe(200);
      expect(patchRes.body.ok).toBe(true);
      expect(patchRes.body.data.available).toBe(initialAvail + 1);

      // Decrement back with -1 delta
      const decRes = await request(app)
        .patch('/api/hospitals/H001/beds')
        .set('Authorization', `Bearer ${h001Token}`)
        .send({
          bedType: 'General',
          delta: -1
        });

      expect(decRes.status).toBe(200);
      expect(decRes.body.data.available).toBe(initialAvail);
    });
  });

  describe('PATCH /api/hospitals/:id/doctors', () => {
    it('should allow staff to update doctors on duty by specialty', async () => {
      const res = await request(app)
        .patch('/api/hospitals/H001/doctors')
        .set('Authorization', `Bearer ${h001Token}`)
        .send({
          specialty: 'cardiac',
          count: 5,
          shift_start: '08:00',
          shift_end: '20:00'
        });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.data.specialty).toBe('cardiac');
      expect(res.body.data.count).toBe(5);
    });
  });

  describe('POST /api/hospitals/:id/incoming/:reqId/accept', () => {
    it('should accept incoming patient and confirm hold', async () => {
      const reqId = 'REQ_ENDPOINT_ACCEPT_1';
      await setupEmergencyPatient(reqId, 'H001');

      const res = await request(app)
        .post(`/api/hospitals/H001/incoming/${reqId}/accept`)
        .set('Authorization', `Bearer ${h001Token}`);

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.data.status).toBe('HOSPITAL_ACCEPTED');
      expect(res.body.data.requestId).toBe(reqId);
    });
  });

  describe('POST /api/hospitals/:id/incoming/:reqId/reject', () => {
    it('should reject patient when mandatory reason is provided and trigger cascade', async () => {
      const reqId = 'REQ_ENDPOINT_REJECT_1';
      await setupEmergencyPatient(reqId, 'H001');

      const res = await request(app)
        .post(`/api/hospitals/H001/incoming/${reqId}/reject`)
        .set('Authorization', `Bearer ${h001Token}`)
        .send({
          reason: 'CT scanner offline for scheduled emergency maintenance'
        });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.data.status).toBe('HOSPITAL_REJECTED');
      expect(res.body.data.cascaded).toBe(true);
    });

    it('should return 400 VALIDATION_ERROR if reject reason is missing', async () => {
      const reqId = 'REQ_ENDPOINT_REJECT_NO_REASON';
      await setupEmergencyPatient(reqId, 'H001');

      const res = await request(app)
        .post(`/api/hospitals/H001/incoming/${reqId}/reject`)
        .set('Authorization', `Bearer ${h001Token}`)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.ok).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('POST /api/hospitals/:id/incoming/:reqId/arrived', () => {
    it('should complete patient handover, mark request COMPLETED, and free ambulance', async () => {
      const reqId = 'REQ_ENDPOINT_ARRIVED_1';
      await setupEmergencyPatient(reqId, 'H001');

      // Staff first accepts
      await request(app)
        .post(`/api/hospitals/H001/incoming/${reqId}/accept`)
        .set('Authorization', `Bearer ${h001Token}`);

      // Staff clicks "Patient arrived"
      const arrivedRes = await request(app)
        .post(`/api/hospitals/H001/incoming/${reqId}/arrived`)
        .set('Authorization', `Bearer ${h001Token}`);

      expect(arrivedRes.status).toBe(200);
      expect(arrivedRes.body.ok).toBe(true);
      expect(arrivedRes.body.data.status).toBe('COMPLETED');

      // Ambulance A001 must be free in DB
      const ambRes = await db.query("SELECT status, current_request_id FROM ambulances WHERE id = 'A001'");
      expect(ambRes.rows[0].status).toBe('free');
      expect(ambRes.rows[0].current_request_id).toBeNull();
    });
  });

  describe('GET /api/hospitals/:id/history and /audit-trail', () => {
    it('should return past history and status log audit trail', async () => {
      const historyRes = await request(app)
        .get('/api/hospitals/H001/history')
        .set('Authorization', `Bearer ${h001Token}`);

      expect(historyRes.status).toBe(200);
      expect(historyRes.body.ok).toBe(true);
      expect(historyRes.body.data.history).toBeInstanceOf(Array);

      const auditRes = await request(app)
        .get('/api/hospitals/H001/audit-trail')
        .set('Authorization', `Bearer ${h001Token}`);

      expect(auditRes.status).toBe(200);
      expect(auditRes.body.ok).toBe(true);
      expect(auditRes.body.data.auditLogs).toBeInstanceOf(Array);
    });
  });

  describe('Cross-Hospital Security & Data Isolation (Plan 13)', () => {
    it('should reject H001 staff attempting to access H002 incoming desk (403 FORBIDDEN)', async () => {
      const res = await request(app)
        .get('/api/hospitals/H002/incoming')
        .set('Authorization', `Bearer ${h001Token}`);

      expect(res.status).toBe(403);
      expect(res.body.ok).toBe(false);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });
  });
});
