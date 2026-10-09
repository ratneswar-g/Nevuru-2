import dotenv from 'dotenv';
import { PostgresDatabaseDriver } from '../src/server/db/driver.ts';

dotenv.config();

export async function resetDatabaseData(): Promise<{ success: boolean; tableCounts: Record<string, number> }> {
  console.log('[Reset Data] Connecting to PostgreSQL database...');
  const driver = new PostgresDatabaseDriver();
  await driver.connect();

  console.log('[Reset Data] Connected. Clearing application tables in foreign-key dependency order...');

  const tablesToClear = [
    'emergency_incidents',
    'pricing_snapshots',
    'journey_state_history',
    'journey_idempotency_keys',
    'payments',
    'journeys',
    'trusted_contact_permissions',
    'family_contacts',
    'vehicles',
    'care_partner_profiles',
    'patient_profiles',
    'otp_challenges',
    'auth_sessions',
    'audit_logs',
    'users',
  ];

  for (const table of tablesToClear) {
    try {
      await driver.execute(`DELETE FROM ${table}`);
      console.log(`  ✓ Cleared table: ${table}`);
    } catch (err: any) {
      console.warn(`  ! Could not clear table ${table}: ${err.message}`);
    }
  }

  console.log('[Reset Data] Re-seeding clean standard partner hospitals (without demo tags)...');
  try {
    await driver.execute(`DELETE FROM hospitals`);
    const cleanHospitals = [
      {
        id: 'hosp-manipal',
        name: 'Manipal Hospital',
        address: '98 HAL Airport Road, Kodihalli, Bengaluru',
        latitude: 12.9592,
        longitude: 77.6499,
        entranceOrDepartment: 'Specialty Clinic Pavilion (East Wing, OPD 2)',
        accessNotes: 'Assistance desk immediately right of entryway. Wheelchair accessible.',
      },
      {
        id: 'hosp-fortis',
        name: 'Fortis Hospital',
        address: '154/9 Bannerghatta Road, Opposite IIMB, Bengaluru',
        latitude: 12.8938,
        longitude: 77.5976,
        entranceOrDepartment: 'Main Reception & Emergency Triage',
        accessNotes: 'Ramp access at main patient drop-off portico.',
      },
      {
        id: 'hosp-apollo',
        name: 'Apollo Hospital',
        address: '154/11 Bannerghatta Road, Bengaluru',
        latitude: 12.8925,
        longitude: 77.5985,
        entranceOrDepartment: 'Outpatient Care Center (Gate 2)',
        accessNotes: 'Dedicated patient accompaniment assistance counter.',
      },
    ];

    for (const h of cleanHospitals) {
      await driver.execute(
        `INSERT INTO hospitals (id, name, address, latitude, longitude, entrance_or_department, access_notes, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           address = EXCLUDED.address,
           latitude = EXCLUDED.latitude,
           longitude = EXCLUDED.longitude,
           entrance_or_department = EXCLUDED.entrance_or_department,
           access_notes = EXCLUDED.access_notes,
           updated_at = NOW()`,
        [h.id, h.name, h.address, h.latitude, h.longitude, h.entranceOrDepartment, h.accessNotes]
      );
    }
    console.log(`  ✓ Seeded ${cleanHospitals.length} standard hospital destinations`);
  } catch (err: any) {
    console.warn(`  ! Hospital seeding warning: ${err.message}`);
  }

  console.log('[Reset Data] Verifying table row counts...');
  const verifyTables = [
    'users',
    'patient_profiles',
    'care_partner_profiles',
    'journeys',
    'journey_state_history',
    'pricing_snapshots',
    'emergency_incidents',
    'payments',
    'journey_idempotency_keys',
    'otp_challenges',
    'auth_sessions',
    'audit_logs',
    'hospitals',
  ];

  const tableCounts: Record<string, number> = {};
  for (const t of verifyTables) {
    const res = await driver.query(`SELECT count(*) FROM ${t}`);
    const count = parseInt(res[0]?.count || '0', 10);
    tableCounts[t] = count;
    console.log(`  Table [${t}]: ${count} rows`);
  }

  await driver.disconnect();
  console.log('[Reset Data] Database reset completed successfully!');
  return { success: true, tableCounts };
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('reset-dev-data.ts')) {
  resetDatabaseData()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[Reset Data] Failed:', err);
      process.exit(1);
    });
}
