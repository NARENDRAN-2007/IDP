import { describe, it, expect, beforeAll } from 'vitest';
import { db } from '../src/db/index.js';
import { seedDatabase } from '../src/db/seed.js';

describe('Phase 1: Database, Migrations, and Seed Integrity with Chennai Dataset', () => {
  beforeAll(async () => {
    await seedDatabase();
  });

  it('should seed exactly 22 Chennai hospitals with coordinates, addresses, and ownership', async () => {
    const res = await db.query('SELECT COUNT(*) as count FROM hospitals');
    expect(parseInt(res.rows[0].count, 10)).toBe(22);

    const apollo = await db.query("SELECT * FROM hospitals WHERE id = 'H001'");
    expect(apollo.rows.length).toBe(1);
    expect(apollo.rows[0].name).toBe('Apollo Hospitals Greams Road');
    expect(apollo.rows[0].ownership).toBe('private');
    expect(apollo.rows[0].empanelled).toBe(true);
  });

  it('should enforce specialty vocabulary (general | cardiac | neuro | obstetric)', async () => {
    const validVocabulary = ['general', 'cardiac', 'neuro', 'obstetric'];
    const res = await db.query('SELECT id, specialties FROM hospitals');
    
    for (const row of res.rows) {
      expect(Array.isArray(row.specialties)).toBe(true);
      expect(row.specialties.length).toBeGreaterThan(0);
      for (const spec of row.specialties) {
        expect(validVocabulary).toContain(spec);
      }
    }
  });

  it('should seed ER, ICU, and General beds for every hospital matching provided numbers', async () => {
    const res = await db.query('SELECT hospital_id, bed_type, total, available FROM hospital_beds');
    expect(res.rows.length).toBe(22 * 3); // 22 hospitals * 3 bed types

    // Check H001 specific beds: ER: 30/5, ICU: 53/1, General: 207/34
    const h001Beds = res.rows.filter((b) => b.hospital_id === 'H001');
    const er = h001Beds.find((b) => b.bed_type === 'ER');
    const icu = h001Beds.find((b) => b.bed_type === 'ICU');
    const gen = h001Beds.find((b) => b.bed_type === 'General');

    expect(er).toEqual(expect.objectContaining({ total: 30, available: 5 }));
    expect(icu).toEqual(expect.objectContaining({ total: 53, available: 1 }));
    expect(gen).toEqual(expect.objectContaining({ total: 207, available: 34 }));
  });

  it('should seed 108 doctor shifts on duty as informational context', async () => {
    const res = await db.query('SELECT COUNT(*) as count FROM doctors_on_duty');
    expect(parseInt(res.rows[0].count, 10)).toBe(108);

    const shifts = await db.query('SELECT specialty, count, shift_start, shift_end FROM doctors_on_duty LIMIT 10');
    for (const doc of shifts.rows) {
      expect(['general', 'cardiac', 'neuro', 'obstetric']).toContain(doc.specialty);
      expect(doc.count).toBeGreaterThanOrEqual(0);
      expect(['08:00', '20:00']).toContain(doc.shift_start);
      expect(['08:00', '20:00']).toContain(doc.shift_end);
    }
  });

  it('should seed 22 hospital_staff users with hashed passwords and matching hospital entityId', async () => {
    const res = await db.query("SELECT id, email, role, entity_id FROM users WHERE role = 'hospital_staff'");
    expect(res.rows.length).toBe(22);

    const apolloStaff = res.rows.find((u) => u.entity_id === 'H001');
    expect(apolloStaff).toBeDefined();
    expect(apolloStaff?.email).toBe('staff_h001@hospital.er');
  });

  it('should seed 10 ambulances with real plates and base areas', async () => {
    const res = await db.query('SELECT id, plate, status, lat, lng FROM ambulances');
    expect(res.rows.length).toBe(10);
    expect(res.rows[0].plate).toContain('TN09 AB');
    expect(res.rows[0].status).toBe('free');
  });
});
