import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { db } from '../src/db/index.js';
import { seedDatabase } from '../src/db/seed.js';
import { BedReservationService } from '../src/services/bedReservationService.js';

describe('Phase 3: Minimal Simulator (Plan 4.7, 7.7)', () => {
  beforeAll(async () => {
    await seedDatabase();
    await BedReservationService.init();
  });

  beforeEach(async () => {
    await db.query(
      "UPDATE hospital_beds SET total = 53, available = 5 WHERE hospital_id = 'H001' AND bed_type = 'ICU'"
    );
  });

  it('POST /api/simulate/load should create emergency requests with holds and allocated ambulance', async () => {
    const res = await request(app)
      .post('/api/simulate/load')
      .send({
        count: 2,
        symptomsText: 'Severe chest tightness and sudden collapse',
        lat: 13.060,
        lng: 80.250,
        targetHospitalId: 'H001'
      });

    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.simulatedCount).toBe(2);
    expect(res.body.data.requests.length).toBe(2);

    const firstReq = res.body.data.requests[0];
    expect(firstReq.requestId).toBeDefined();
    expect(firstReq.holdId).toBeDefined();
    expect(firstReq.hospitalId).toBe('H001');
    expect(firstReq.bedType).toBe('ICU'); // chest pain -> level 1 -> ICU

    // Verify DB state
    const holdRes = await db.query('SELECT status, bed_type FROM bed_holds WHERE id = $1', [firstReq.holdId]);
    expect(holdRes.rows[0].status).toBe('pending');
    expect(holdRes.rows[0].bed_type).toBe('ICU');
  });

  it('POST /api/simulate/ambulance-gps should record location ping and update ambulance', async () => {
    const res = await request(app)
      .post('/api/simulate/ambulance-gps')
      .send({
        ambulanceId: 'A001',
        lat: 13.065,
        lng: 80.255,
        speed: 52
      });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.recorded).toBe(true);
    expect(res.body.data.ambulanceId).toBe('A001');

    // Verify ambulance position in DB
    const amb = await db.query("SELECT lat, lng FROM ambulances WHERE id = 'A001'");
    expect(amb.rows[0].lat).toBe(13.065);
    expect(amb.rows[0].lng).toBe(80.255);
  });

  it('POST /api/simulate/vitals should record vitals telemetry from MAX30102', async () => {
    const loadRes = await request(app)
      .post('/api/simulate/load')
      .send({ count: 1, targetHospitalId: 'H001' });

    const reqId = loadRes.body.data.requests[0].requestId;

    const res = await request(app)
      .post('/api/simulate/vitals')
      .send({
        requestId: reqId,
        ambulanceId: 'A001',
        hr: 112,
        spo2: 94,
        valid: true
      });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.recorded).toBe(true);
    expect(res.body.data.hr).toBe(112);
    expect(res.body.data.spo2).toBe(94);

    // Verify reading in DB
    const vitalsRes = await db.query(
      'SELECT hr, spo2, valid FROM vitals_readings WHERE request_id = $1 ORDER BY ts DESC LIMIT 1',
      [reqId]
    );
    expect(vitalsRes.rows[0].hr).toBe(112);
    expect(vitalsRes.rows[0].spo2).toBe(94);
  });

  it('POST /api/simulate/reset should reset simulation state to seed numbers', async () => {
    const res = await request(app).post('/api/simulate/reset');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const holdsRes = await db.query('SELECT COUNT(*) as count FROM bed_holds');
    expect(parseInt(holdsRes.rows[0].count, 10)).toBe(0);

    const reqRes = await db.query('SELECT COUNT(*) as count FROM requests');
    expect(parseInt(reqRes.rows[0].count, 10)).toBe(0);
  });
});
