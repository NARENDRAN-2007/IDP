import { describe, it, expect, beforeAll } from 'vitest';
import { db } from '../src/db/index.js';
import { seedDatabase } from '../src/db/seed.js';
import { BedReservationService } from '../src/services/bedReservationService.js';

describe('Phase 2 Integration: Concurrent Requests against Limited Beds (Plan 5.3a)', () => {
  beforeAll(async () => {
    await seedDatabase();
    await BedReservationService.init();
  });

  it('N parallel requests against M beds: no negative bed count and no double assignment', async () => {
    const testHospitalId = 'H006'; // VS Hospitals Kilpauk
    const M_BEDS = 3;
    const N_REQUESTS = 10;

    // Set available ICU beds to exactly M_BEDS
    await db.query(
      `UPDATE hospital_beds
       SET total = $1, available = $1
       WHERE hospital_id = $2 AND bed_type = 'ICU'`,
      [M_BEDS, testHospitalId]
    );

    // Create N emergency requests
    const requestIds: string[] = [];
    for (let i = 1; i <= N_REQUESTS; i++) {
      const reqId = `REQ_CONCURRENT_${i}_${Date.now()}`;
      requestIds.push(reqId);
      await db.query(
        `INSERT INTO requests (id, lat, lng, required_specialty, bed_type, status, created_at)
         VALUES ($1, 13.077, 80.241, 'neuro', 'ICU', 'TRIGGERED', NOW())`,
        [reqId]
      );
    }

    // Fire all N requests simultaneously in parallel
    const reservationPromises = requestIds.map(async (reqId) => {
      try {
        const hold = await BedReservationService.reserveBedProvisional(testHospitalId, 'ICU', reqId);
        return { success: true, holdId: hold.id, reqId };
      } catch (err: any) {
        return { success: false, error: err.message, reqId };
      }
    });

    const results = await Promise.all(reservationPromises);

    const successfulHolds = results.filter((r) => r.success);
    const failedHolds = results.filter((r) => !r.success);

    // 1. Exactly M requests must have succeeded
    expect(successfulHolds.length).toBe(M_BEDS);
    expect(failedHolds.length).toBe(N_REQUESTS - M_BEDS);

    // 2. Check bed availability in Postgres: must be exactly 0, NEVER negative
    const bedCheck = await db.query(
      `SELECT total, available
       FROM hospital_beds
       WHERE hospital_id = $1 AND bed_type = 'ICU'`,
      [testHospitalId]
    );
    expect(bedCheck.rows[0].available).toBe(0);

    // 3. No double assignments: every successful holdId must be unique
    const holdIds = successfulHolds.map((r) => r.holdId);
    const uniqueHoldIds = new Set(holdIds);
    expect(uniqueHoldIds.size).toBe(M_BEDS);

    // 4. Verify each hold in Postgres is mapped to exactly one request
    for (const h of successfulHolds) {
      const holdRes = await db.query('SELECT request_id, hospital_id, status FROM bed_holds WHERE id = $1', [
        h.holdId
      ]);
      expect(holdRes.rows.length).toBe(1);
      expect(holdRes.rows[0].request_id).toBe(h.reqId);
      expect(holdRes.rows[0].hospital_id).toBe(testHospitalId);
      expect(holdRes.rows[0].status).toBe('pending');
    }
  });
});
