import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { db } from '../src/db/index.js';
import { seedDatabase } from '../src/db/seed.js';
import { BedReservationService } from '../src/services/bedReservationService.js';
import { holdTimerQueue } from '../jobs/holdTimerQueue.js';

describe('Phase 2: Core Bed Hold Engine & Lifecycle (Plan 5.3a, 5.7)', () => {
  beforeAll(async () => {
    await seedDatabase();
    await BedReservationService.init();
  });

  beforeEach(async () => {
    await db.query(
      "UPDATE hospital_beds SET total = 53, available = 5 WHERE hospital_id = 'H001' AND bed_type = 'ICU'"
    );
  });

  const createTestEmergencyRequest = async (id: string, specialty = 'cardiac') => {
    await db.query(
      `INSERT INTO requests (id, lat, lng, required_specialty, bed_type, status, created_at)
       VALUES ($1, 13.063, 80.251, $2, 'ICU', 'TRIGGERED', NOW())
       ON CONFLICT (id) DO UPDATE SET status = 'TRIGGERED', active_hold_id = NULL, cascade_count = 0`,
      [id, specialty]
    );
  };

  it('should place an atomic provisional hold and decrement bed available count', async () => {
    const reqId = 'REQ_TEST_ATOMIC_1';
    await createTestEmergencyRequest(reqId, 'cardiac');

    // Get current ICU beds for Apollo (H001)
    const beforeRes = await db.query(
      "SELECT available FROM hospital_beds WHERE hospital_id = 'H001' AND bed_type = 'ICU'"
    );
    const initialAvail = beforeRes.rows[0].available;

    const hold = await BedReservationService.reserveBedProvisional('H001', 'ICU', reqId);
    expect(hold.id).toBeDefined();
    expect(hold.status).toBe('pending');
    expect(hold.hospitalId).toBe('H001');
    expect(hold.bedType).toBe('ICU');

    // Verify Postgres available count is decremented by exactly 1
    const afterRes = await db.query(
      "SELECT available FROM hospital_beds WHERE hospital_id = 'H001' AND bed_type = 'ICU'"
    );
    expect(afterRes.rows[0].available).toBe(initialAvail - 1);

    // Verify request table updated
    const reqRes = await db.query('SELECT active_hold_id, status FROM requests WHERE id = $1', [reqId]);
    expect(reqRes.rows[0].active_hold_id).toBe(hold.id);
    expect(reqRes.rows[0].status).toBe('BED_HELD');
  });

  it('should confirm hold when accepted by hospital staff and keep bed deducted', async () => {
    const reqId = 'REQ_TEST_CONFIRM_1';
    await createTestEmergencyRequest(reqId, 'cardiac');

    const hold = await BedReservationService.reserveBedProvisional('H001', 'ICU', reqId);
    const confirmed = await BedReservationService.confirmReservation(reqId, 'H001');

    expect(confirmed.status).toBe('confirmed');

    // Verify DB status
    const dbHold = await db.query('SELECT status FROM bed_holds WHERE id = $1', [hold.id]);
    expect(dbHold.rows[0].status).toBe('confirmed');

    const reqRes = await db.query('SELECT status, confirmed_hospital_id FROM requests WHERE id = $1', [reqId]);
    expect(reqRes.rows[0].status).toBe('HOSPITAL_ACCEPTED');
    expect(reqRes.rows[0].confirmed_hospital_id).toBe('H001');
  });

  it('CRITICAL PLAN 5.3a: timer firing after hold was already confirmed must be a strict NO-OP', async () => {
    const reqId = 'REQ_TEST_NOOP_TIMER';
    await createTestEmergencyRequest(reqId, 'cardiac');

    const hold = await BedReservationService.reserveBedProvisional('H001', 'ICU', reqId);
    await BedReservationService.confirmReservation(reqId, 'H001');

    // Bed available count right after confirm
    const beforeTimerRes = await db.query(
      "SELECT available FROM hospital_beds WHERE hospital_id = 'H001' AND bed_type = 'ICU'"
    );
    const availBeforeTimer = beforeTimerRes.rows[0].available;

    // Simulate timer firing at expiresAt
    const cascadeResult = await BedReservationService.releaseAndCascade(hold.id, 'TIMEOUT');

    // Worker must NO-OP
    expect(cascadeResult.cascaded).toBe(false);

    // Bed must NOT have been restored
    const afterTimerRes = await db.query(
      "SELECT available FROM hospital_beds WHERE hospital_id = 'H001' AND bed_type = 'ICU'"
    );
    expect(afterTimerRes.rows[0].available).toBe(availBeforeTimer);

    // Hold status in DB must remain 'confirmed'
    const holdRes = await db.query('SELECT status FROM bed_holds WHERE id = $1', [hold.id]);
    expect(holdRes.rows[0].status).toBe('confirmed');
  });

  it('should release bed and cascade to next candidate on staff reject', async () => {
    const reqId = 'REQ_TEST_REJECT_CASCADE';
    await createTestEmergencyRequest(reqId, 'neuro');

    const beforeAvail = await db.query(
      "SELECT available FROM hospital_beds WHERE hospital_id = 'H001' AND bed_type = 'ICU'"
    );

    const hold = await BedReservationService.reserveBedProvisional('H001', 'ICU', reqId);

    // Staff rejects with mandatory reason
    const cascadeResult = await BedReservationService.rejectReservation(
      reqId,
      'H001',
      'Neuro ICU currently operating at emergency surgical capacity'
    );

    expect(cascadeResult.cascaded).toBe(true);
    expect(cascadeResult.nextHospitalId).toBeDefined();
    expect(cascadeResult.nextHospitalId).not.toBe('H001');

    // Hospital H001 ICU bed should be released back to initial
    const afterAvail = await db.query(
      "SELECT available FROM hospital_beds WHERE hospital_id = 'H001' AND bed_type = 'ICU'"
    );
    expect(afterAvail.rows[0].available).toBe(beforeAvail.rows[0].available);

    // Original hold marked released
    const oldHoldRes = await db.query('SELECT status FROM bed_holds WHERE id = $1', [hold.id]);
    expect(oldHoldRes.rows[0].status).toBe('released');
  });

  it('should recover pending holds on boot (Plan 5.7)', async () => {
    const reqId = 'REQ_TEST_BOOT_RECOVERY';
    await createTestEmergencyRequest(reqId, 'cardiac');

    // Insert an artificially expired pending hold
    const expiredHoldId = 'HOLD_ARTIFICIAL_EXPIRED';
    await db.query(
      `INSERT INTO bed_holds (id, request_id, hospital_id, bed_type, created_at, expires_at, status)
       VALUES ($1, $2, 'H001', 'ICU', NOW() - INTERVAL '1 minute', NOW() - INTERVAL '10 seconds', 'pending')
       ON CONFLICT (id) DO NOTHING`,
      [expiredHoldId, reqId]
    );

    await db.query(
      `UPDATE requests SET active_hold_id = $1, provisional_hospital_id = 'H001', status = 'BED_HELD' WHERE id = $2`,
      [expiredHoldId, reqId]
    );

    // Decrement bed to simulate the held state
    await db.query(
      "UPDATE hospital_beds SET available = available - 1 WHERE hospital_id = 'H001' AND bed_type = 'ICU'"
    );

    const preAvail = (
      await db.query("SELECT available FROM hospital_beds WHERE hospital_id = 'H001' AND bed_type = 'ICU'")
    ).rows[0].available;

    // Run boot recovery
    await BedReservationService.recoverPendingHoldsOnBoot();

    // Verify overdue hold was expired and bed restored
    const holdRes = await db.query('SELECT status FROM bed_holds WHERE id = $1', [expiredHoldId]);
    expect(holdRes.rows[0].status).toBe('expired');

    const postAvail = (
      await db.query("SELECT available FROM hospital_beds WHERE hospital_id = 'H001' AND bed_type = 'ICU'")
    ).rows[0].available;
    expect(postAvail).toBe(preAvail + 1);
  });
});
