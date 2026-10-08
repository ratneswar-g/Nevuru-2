import assert from 'node:assert/strict';
import { InMemoryRelationalDriver } from '../src/server/db/driver.ts';
import { PostgresDomainStore } from '../src/server/db/repositories/postgres-repositories.ts';
import { runMigrations } from '../src/server/db/migrate.ts';
import { JourneyService } from '../src/services/journey-service.ts';
import { NotificationService } from '../src/services/notification-service.ts';
import { NotificationProvider, DevelopmentConsoleOtpProvider } from '../src/server/auth/sms-provider.ts';
import { DEV_IDENTITIES } from '../src/auth/development-auth.ts';
import { JourneyState } from '../src/domain/types/journey.ts';

let testCount = 0;
let passCount = 0;

async function runTest(name: string, fn: () => Promise<void>) {
  testCount++;
  try {
    await fn();
    passCount++;
    console.log(`  ✓ [NOTIFICATION TEST ${testCount}] ${name}`);
  } catch (err) {
    console.error(`  ✗ [NOTIFICATION TEST ${testCount} FAILED] ${name}`);
    console.error(err);
    throw err;
  }
}

class MockNotificationProvider implements NotificationProvider {
  public providerName = 'MockNotificationProvider';
  public isProductionProvider = false;
  public dispatches: Array<{ phoneNumber: string; message: string; referenceId: string }> = [];
  public shouldFail = false;

  async sendNotification(phoneNumber: string, message: string, referenceId: string) {
    if (this.shouldFail) {
      throw new Error('Simulated SMS gateway failure');
    }
    this.dispatches.push({ phoneNumber, message, referenceId });
    return { delivered: true, providerName: this.providerName, messageId: `mock_msg_${Date.now()}` };
  }
}

async function createHarness() {
  process.env.NODE_ENV = 'test';
  const driver = new InMemoryRelationalDriver();
  await driver.connect();
  await runMigrations(driver);
  const store = new PostgresDomainStore(driver);
  const mockProvider = new MockNotificationProvider();
  const service = new JourneyService(store, mockProvider);
  await service.seedInitialDomainData();

  const patient = DEV_IDENTITIES.PATIENT;
  const partner = DEV_IDENTITIES.CARE_PARTNER;
  const admin = DEV_IDENTITIES.ADMIN;

  const cleanup = async () => {
    await driver.disconnect();
  };

  return {
    store,
    service,
    mockProvider,
    patient,
    partner,
    admin,
    cleanup,
  };
}

async function runAllNotificationTests() {
  console.log('\n======================================================');
  console.log('NERAVU MILESTONE NOTIFICATIONS VALIDATION TEST SUITE');
  console.log('======================================================\n');

  const harness = await createHarness();

  try {
    const hosp = (await harness.service.getHospitals())[0];
    const patientProfile = await harness.service.getPatientProfile(harness.patient.id);

    const createFreshBooking = async () => {
      const active = await harness.service.getActiveJourneyForPatient(harness.patient.id);
      if (active) {
        await harness.store.journeys.save({
          ...active,
          currentState: 'COMPLETED',
          updatedAt: new Date().toISOString(),
        });
      }
      return harness.service.createBooking(harness.patient, {
        pickupLocation: patientProfile.homeAddress,
        hospitalDestination: hosp,
        bookingType: 'ON_DEMAND',
      });
    };

    // ----------------------------------------------------
    // TEST 1: Milestone Trigger & Booking Confirmed Test
    // ----------------------------------------------------
    await runTest('1. Booking confirmed milestone: Triggers notification to patient upon booking creation', async () => {
      harness.mockProvider.dispatches = [];

      const booking = await createFreshBooking();

      assert.ok(booking, 'Booking must be created');
      const patientDispatches = harness.mockProvider.dispatches.filter(
        (d) => d.phoneNumber === harness.patient.phone
      );
      assert.ok(patientDispatches.length >= 1, 'Patient must receive booking confirmation notification');
      assert.ok(patientDispatches[0].message.includes('confirmed'), 'Message must indicate booking confirmation');
    });

    // ----------------------------------------------------
    // TEST 2: Care Partner Assigned Milestone Test
    // ----------------------------------------------------
    await runTest('2. Care Partner assigned milestone: Triggers notification upon partner accepting journey', async () => {
      const booking = await createFreshBooking();

      harness.mockProvider.dispatches = [];
      const assigned = await harness.service.acceptJourney(harness.partner, booking.id);
      assert.equal(assigned.currentState, 'PARTNER_ASSIGNED');

      const dispatches = harness.mockProvider.dispatches;
      assert.ok(dispatches.some((d) => d.message.includes('PARTNER_ASSIGNED') || d.message.includes('Care Partner assigned')), 'Must notify of partner assignment');
    });

    // ----------------------------------------------------
    // TEST 3: Full Milestone Lifecycle Progression (En Route -> Arrived -> Picked Up -> Hospital -> Return -> Completed)
    // ----------------------------------------------------
    await runTest('3. Full milestone progression: En route, arrived, picked up, hospital arrival, return start, completion', async () => {
      const booking = await createFreshBooking();
      let curr = await harness.service.acceptJourney(harness.partner, booking.id);

      const milestones: JourneyState[] = [
        'PARTNER_EN_ROUTE',
        'PARTNER_ARRIVED',
        'PATIENT_PICKED_UP',
        'IN_TRANSIT_TO_HOSPITAL',
        'ARRIVED_AT_HOSPITAL',
        'HOSPITAL_VISIT',
        'RETURN_STARTED',
        'IN_TRANSIT_TO_HOME',
        'PATIENT_RETURNED_HOME',
        'COMPLETED',
      ];

      for (const m of milestones) {
        harness.mockProvider.dispatches = [];
        curr = await harness.service.advanceMilestone(harness.partner, curr.id, m);
        assert.equal(curr.currentState, m);
        assert.ok(
          harness.mockProvider.dispatches.length > 0,
          `Milestone transition to ${m} must dispatch notifications`
        );
      }
    });

    // ----------------------------------------------------
    // TEST 4: Recipient Authorization & Privacy (Family Permission Levels)
    // ----------------------------------------------------
    await runTest('4. Recipient authorization & privacy: Trusted contacts notified per permission level; no sensitive medical data exposed', async () => {
      const profile = await harness.service.getPatientProfile(harness.patient.id);
      profile.trustedContacts = [
        {
          id: 'fc-full',
          patientId: harness.patient.id,
          contactName: 'Full Access Family',
          relationship: 'Spouse',
          phone: '+919999911111',
          permissionLevel: 'FULL_STATUS',
        },
        {
          id: 'fc-emergency',
          patientId: harness.patient.id,
          contactName: 'Emergency Only Family',
          relationship: 'Sibling',
          phone: '+919999922222',
          permissionLevel: 'EMERGENCY_ONLY',
        },
      ];
      await harness.store.patientProfiles.save(profile);

      harness.mockProvider.dispatches = [];
      const booking = await createFreshBooking();

      const dispatches = harness.mockProvider.dispatches;
      assert.ok(
        dispatches.some((d) => d.phoneNumber === '+919999911111'),
        'Contact with FULL_STATUS permission level must receive milestone notification'
      );
      assert.equal(
        dispatches.some((d) => d.phoneNumber === '+919999922222'),
        false,
        'Contact with EMERGENCY_ONLY permission level must NOT receive standard milestone notifications'
      );

      for (const d of dispatches) {
        const lower = d.message.toLowerCase();
        assert.equal(lower.includes('diagnosis'), false);
        assert.equal(lower.includes('prescription'), false);
        assert.equal(lower.includes('treatment'), false);
      }
    });

    // ----------------------------------------------------
    // TEST 5: Duplicate Notification / Idempotency Test
    // ----------------------------------------------------
    await runTest('5. Duplicate notification: Re-processing same milestone transition does not send duplicate notifications', async () => {
      const booking = await createFreshBooking();

      harness.mockProvider.dispatches = [];
      await harness.service.notificationService.notifyJourneyMilestone(booking, 'MATCHING', harness.patient.id);
      const count1 = harness.mockProvider.dispatches.length;

      await harness.service.notificationService.notifyJourneyMilestone(booking, 'MATCHING', harness.patient.id);
      const count2 = harness.mockProvider.dispatches.length;

      assert.equal(count1, count2, 'Second trigger for same milestone must be de-duplicated (zero new dispatches)');
    });

    // ----------------------------------------------------
    // TEST 6: Provider Failure / Graceful Fallback Test
    // ----------------------------------------------------
    await runTest('6. Provider failure / graceful fallback: SMS gateway outage does not corrupt or roll back journey state', async () => {
      harness.mockProvider.shouldFail = true;

      const booking = await createFreshBooking();
      const assigned = await harness.service.acceptJourney(harness.partner, booking.id);
      assert.equal(assigned.currentState, 'PARTNER_ASSIGNED', 'Journey state must advance successfully despite provider failure');

      harness.mockProvider.shouldFail = false; // Reset
    });

    // ----------------------------------------------------
    // TEST 7: Audit Logging Test
    // ----------------------------------------------------
    await runTest('7. Audit logging: Dispatched notifications are correctly recorded in audit logs', async () => {
      const logs = await harness.store.auditLogs.findAll();
      const notifLogs = logs.filter((l: any) => l.entityType === 'notification');
      assert.ok(notifLogs.length > 0, 'Audit logs must record notification dispatches');
      assert.equal(notifLogs[0].action, 'MILESTONE_NOTIFICATION_DISPATCHED');
    });

    console.log('\n------------------------------------------------------');
    console.log(`TOTAL NOTIFICATION TESTS: ${testCount} | PASSED: ${passCount} | FAILED: 0`);
    console.log('ALL P1 MILESTONE NOTIFICATION TESTS PASSED!');
    console.log('------------------------------------------------------\n');
  } finally {
    await harness.cleanup();
  }
}

runAllNotificationTests().catch((err) => {
  console.error('[TEST SUITE FATAL ERROR]', err);
  process.exit(1);
});
