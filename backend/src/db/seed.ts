import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';
import { db } from './index.js';
import { logger } from '../utils/logger.js';
import { runMigrations } from './migrate.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function seedDatabase(runMigrate = true) {
  logger.info('Starting database seeding with Chennai dataset...');
  if (runMigrate) {
    await runMigrations();
  }

  const datasetPath = path.join(__dirname, '..', '..', 'data', 'chennai-dataset.json');
  const dataset = JSON.parse(fs.readFileSync(datasetPath, 'utf8'));

  const hospitals = dataset.hospitals || [];
  const doctorsOnDuty = dataset.doctors_on_duty || [];
  const users = dataset.users || [];
  const ambulances = dataset.ambulances || [];

  await db.withTransaction(async (client) => {
    // 1. Seed Hospitals and Bed Inventory
    for (const h of hospitals) {
      await client.query(
        `INSERT INTO hospitals (id, name, lat, lng, specialties, empanelled, ownership, address, last_updated)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           lat = EXCLUDED.lat,
           lng = EXCLUDED.lng,
           specialties = EXCLUDED.specialties,
           empanelled = EXCLUDED.empanelled,
           ownership = EXCLUDED.ownership,
           address = EXCLUDED.address,
           last_updated = NOW()`,
        [h.id, h.name, h.lat, h.lng, h.specialties, h.empanelled, h.ownership || null, h.address || null]
      );

      // Seed hospital beds
      const beds = h.beds || {};
      for (const bedType of ['ER', 'ICU', 'General'] as const) {
        const bedInfo = beds[bedType] || { total: 0, available: 0 };
        await client.query(
          `INSERT INTO hospital_beds (hospital_id, bed_type, total, available, updated_at, updated_by)
           VALUES ($1, $2, $3, $4, NOW(), 'system_seed')
           ON CONFLICT (hospital_id, bed_type) DO UPDATE SET
             total = EXCLUDED.total,
             available = EXCLUDED.available,
             updated_at = NOW()`,
          [h.id, bedType, bedInfo.total, bedInfo.available]
        );
      }
    }

    // 2. Seed Doctors on Duty (Informational only per Plan 6.1)
    for (const doc of doctorsOnDuty) {
      const docId = `DOC_${doc.id || doc.hospital_id + '_' + doc.specialty + '_' + doc.shift_start}`;
      await client.query(
        `INSERT INTO doctors_on_duty (id, hospital_id, specialty, count, shift_start, shift_end)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (id) DO UPDATE SET
           count = EXCLUDED.count,
           shift_start = EXCLUDED.shift_start,
           shift_end = EXCLUDED.shift_end`,
        [docId, doc.hospital_id, doc.specialty, doc.count, doc.shift_start, doc.shift_end]
      );
    }

    // 3. Seed Hospital Staff Users
    for (const u of users) {
      const password = u.password_plain || 'Password123!';
      const passwordHash = await bcrypt.hash(password, 10);
      await client.query(
        `INSERT INTO users (id, name, email, phone, password_hash, role, entity_id, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           email = EXCLUDED.email,
           password_hash = EXCLUDED.password_hash,
           role = EXCLUDED.role,
           entity_id = EXCLUDED.entity_id`,
        [u.id, u.name, u.email.toLowerCase().trim(), u.phone || null, passwordHash, u.role, u.entity_id]
      );
    }

    // 4. Seed Ambulances
    for (const amb of ambulances) {
      await client.query(
        `INSERT INTO ambulances (id, plate, status, current_request_id, lat, lng, last_seen)
         VALUES ($1, $2, $3, NULL, $4, $5, NOW())
         ON CONFLICT (id) DO UPDATE SET
           plate = EXCLUDED.plate,
           status = EXCLUDED.status,
           lat = EXCLUDED.lat,
           lng = EXCLUDED.lng`,
        [amb.id, amb.plate, amb.status || 'free', amb.lat, amb.lng]
      );
    }
  });

  logger.info(
    `Database seeded successfully with ${hospitals.length} hospitals, ` +
    `${doctorsOnDuty.length} doctor shift entries, ${users.length} users, and ${ambulances.length} ambulances.`
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  seedDatabase()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
