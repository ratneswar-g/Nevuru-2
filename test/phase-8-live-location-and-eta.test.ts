import assert from "node:assert/strict";
import { InMemoryRelationalDriver } from "../src/server/db/driver.ts";
import { PostgresDomainStore } from "../src/server/db/repositories/postgres-repositories.ts";
import { runMigrations } from "../src/server/db/migrate.ts";
import { JourneyService } from "../src/services/journey-service.ts";
import { createApiApp } from "../src/server/api/app.ts";
import { NeravuApiClient } from "../src/services/api-client.ts";
import { DEV_IDENTITIES } from "../src/auth/development-auth.ts";

let testCount = 0;
let passCount = 0;

async function runTest(name: string, fn: () => Promise<void>) {
  testCount++;
  try {
    await fn();
    passCount++;
    console.log(`  ✓ [LOCATION TEST ${testCount}] ${name}`);
  } catch (err) {
    console.error(`  ✗ [LOCATION TEST ${testCount} FAILED] ${name}`);
    console.error(err);
    throw err;
  }
}

async function createHarness() {
  process.env.NODE_ENV = "test";
  const driver = new InMemoryRelationalDriver();
  await driver.connect();
  await runMigrations(driver);
  const store = new PostgresDomainStore(driver);
  const service = new JourneyService(store);
  await service.seedInitialDomainData();
  const app = createApiApp(service);

  let server: any;
  let baseUrl = "";
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
  });

  const patient = DEV_IDENTITIES.PATIENT;
  const partner = DEV_IDENTITIES.CARE_PARTNER;
  const otherPatient = { id: "usr-unrelated-patient", name: "Unrelated Patient", role: "PATIENT" as const };
  const family = DEV_IDENTITIES.FAMILY_CONTACT;

  await store.users.save({
    id: otherPatient.id,
    name: otherPatient.name,
    phone: "+919845099999",
    role: "PATIENT",
    status: "ACTIVE",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  const patientClient = new NeravuApiClient({
    baseUrl,
    getAuthToken: () => `dev-session-${patient.id}`,
    getUserId: () => patient.id,
    getRole: () => "PATIENT",
  });

  const partnerClient = new NeravuApiClient({
    baseUrl,
    getAuthToken: () => `dev-session-${partner.id}`,
    getUserId: () => partner.id,
    getRole: () => "CARE_PARTNER",
  });

  const unrelatedClient = new NeravuApiClient({
    baseUrl,
    getAuthToken: () => `dev-session-${otherPatient.id}`,
    getUserId: () => otherPatient.id,
    getRole: () => "PATIENT",
  });

  const familyClient = new NeravuApiClient({
    baseUrl,
    getAuthToken: () => `dev-session-${family.id}`,
    getUserId: () => family.id,
    getRole: () => "FAMILY_CONTACT",
  });

  const cleanup = async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (driver.isConnected()) {
      await driver.disconnect();
    }
  };

  return {
    driver,
    store,
    service,
    patientClient,
    partnerClient,
    unrelatedClient,
    familyClient,
    cleanup,
  };
}

async function runLiveLocationTestSuite() {
  console.log("\n==================================================");
  console.log("NERAVU P1: LIVE JOURNEY LOCATION & ETA TEST SUITE");
  console.log("==================================================");

  await runTest("1. Assigned Care Partner can update live location during PARTNER_EN_ROUTE and ETA is computed", async () => {
    const h = await createHarness();
    try {
      const hospitals = await h.patientClient.getHospitals();
      const journey = await h.patientClient.createBooking({
        pickupLocation: { latitude: 12.9784, longitude: 77.6408, address: "42 Indiranagar, Bengaluru" },
        hospitalDestination: hospitals[0],
      });

      await h.partnerClient.acceptJourney(journey.id);
      await h.partnerClient.advanceMilestone(journey.id, "PARTNER_EN_ROUTE");

      const locUpdate = await h.partnerClient.updateLocation(journey.id, {
        latitude: 12.9700,
        longitude: 77.6350,
        heading: 45,
        speed: 8.5,
        accuracy: 5,
      });

      assert.equal(locUpdate.latitude, 12.9700);
      assert.equal(locUpdate.longitude, 77.6350);
      assert.equal(typeof locUpdate.etaSeconds, "number");
      assert.ok(locUpdate.etaText);
      assert.ok(locUpdate.distanceText);
      assert.equal(locUpdate.isStale, false);
      assert.ok(locUpdate.targetDestination?.includes("Indiranagar"));
    } finally {
      await h.cleanup();
    }
  });

  await runTest("2. Patient can retrieve Care Partner live location & ETA via GET /api/journeys/:id/location", async () => {
    const h = await createHarness();
    try {
      const hospitals = await h.patientClient.getHospitals();
      const journey = await h.patientClient.createBooking({
        pickupLocation: { latitude: 12.9784, longitude: 77.6408, address: "42 Indiranagar, Bengaluru" },
        hospitalDestination: hospitals[0],
      });

      await h.partnerClient.acceptJourney(journey.id);
      await h.partnerClient.advanceMilestone(journey.id, "PARTNER_EN_ROUTE");
      await h.partnerClient.updateLocation(journey.id, { latitude: 12.9720, longitude: 77.6380 });

      const locResult = await h.patientClient.getLiveLocation(journey.id);
      assert.equal(locResult.trackingActive, true);
      assert.ok(locResult.liveLocation);
      assert.equal(locResult.liveLocation?.latitude, 12.9720);
      assert.equal(locResult.liveLocation?.longitude, 77.6380);
      assert.equal(locResult.liveLocation?.isStale, false);
    } finally {
      await h.cleanup();
    }
  });

  await runTest("3. Unrelated patient is forbidden from viewing location (IDOR protection)", async () => {
    const h = await createHarness();
    try {
      const hospitals = await h.patientClient.getHospitals();
      const journey = await h.patientClient.createBooking({
        pickupLocation: { latitude: 12.9784, longitude: 77.6408, address: "42 Indiranagar, Bengaluru" },
        hospitalDestination: hospitals[0],
      });

      await h.partnerClient.acceptJourney(journey.id);
      await h.partnerClient.advanceMilestone(journey.id, "PARTNER_EN_ROUTE");
      await h.partnerClient.updateLocation(journey.id, { latitude: 12.9720, longitude: 77.6380 });

      await assert.rejects(
        async () => {
          await h.unrelatedClient.getLiveLocation(journey.id);
        },
        (err: any) => err.status === 403 || err.code === "UNAUTHORIZED_ACTION"
      );
    } finally {
      await h.cleanup();
    }
  });

  await runTest("4. Unassigned Care Partner cannot submit location updates", async () => {
    const h = await createHarness();
    try {
      const hospitals = await h.patientClient.getHospitals();
      const journey = await h.patientClient.createBooking({
        pickupLocation: { latitude: 12.9784, longitude: 77.6408, address: "42 Indiranagar, Bengaluru" },
        hospitalDestination: hospitals[0],
      });

      // Journey is not accepted by anyone yet
      await assert.rejects(
        async () => {
          await h.partnerClient.updateLocation(journey.id, { latitude: 12.9720, longitude: 77.6380 });
        },
        (err: any) => err.status === 403 || err.code === "UNAUTHORIZED_ACTION"
      );
    } finally {
      await h.cleanup();
    }
  });

  await runTest("5. Location updates are rejected outside active transit states", async () => {
    const h = await createHarness();
    try {
      const hospitals = await h.patientClient.getHospitals();
      const journey = await h.patientClient.createBooking({
        pickupLocation: { latitude: 12.9784, longitude: 77.6408, address: "42 Indiranagar, Bengaluru" },
        hospitalDestination: hospitals[0],
      });

      await h.partnerClient.acceptJourney(journey.id);
      // State is PARTNER_ASSIGNED (not in transit yet)
      await assert.rejects(
        async () => {
          await h.partnerClient.updateLocation(journey.id, { latitude: 12.9720, longitude: 77.6380 });
        },
        (err: any) => err.status === 409 || err.code === "INVALID_STATE_FOR_LOCATION_TRACKING"
      );
    } finally {
      await h.cleanup();
    }
  });

  await runTest("6. Location tracking updates work across all active transit states: PARTNER_EN_ROUTE, PATIENT_PICKED_UP, IN_TRANSIT_TO_HOSPITAL, RETURN_STARTED, IN_TRANSIT_TO_HOME", async () => {
    const h = await createHarness();
    try {
      const hospitals = await h.patientClient.getHospitals();
      const journey = await h.patientClient.createBooking({
        pickupLocation: { latitude: 12.9784, longitude: 77.6408, address: "42 Indiranagar, Bengaluru" },
        hospitalDestination: hospitals[0],
      });

      await h.partnerClient.acceptJourney(journey.id);

      // 1. PARTNER_EN_ROUTE
      await h.partnerClient.advanceMilestone(journey.id, "PARTNER_EN_ROUTE");
      const loc1 = await h.partnerClient.updateLocation(journey.id, { latitude: 12.970, longitude: 77.635 });
      assert.ok(loc1.targetDestination?.includes("Indiranagar"));

      // Arrive & verify PIN
      await h.partnerClient.advanceMilestone(journey.id, "PARTNER_ARRIVED");
      const fetched = await h.patientClient.getJourneyById(journey.id);
      await h.partnerClient.verifyPickupPin(journey.id, fetched!.pickupPin!);

      // 2. PATIENT_PICKED_UP
      const loc2 = await h.partnerClient.updateLocation(journey.id, { latitude: 12.978, longitude: 77.640 });
      assert.ok(loc2.targetDestination?.includes(hospitals[0].name));

      // 3. IN_TRANSIT_TO_HOSPITAL
      await h.partnerClient.advanceMilestone(journey.id, "IN_TRANSIT_TO_HOSPITAL");
      const loc3 = await h.partnerClient.updateLocation(journey.id, { latitude: 12.980, longitude: 77.645 });
      assert.ok(loc3.targetDestination?.includes(hospitals[0].name));

      // Arrived at hospital & hospital visit
      await h.partnerClient.advanceMilestone(journey.id, "ARRIVED_AT_HOSPITAL");
      await h.partnerClient.advanceMilestone(journey.id, "HOSPITAL_VISIT");

      // 4. RETURN_STARTED
      await h.partnerClient.advanceMilestone(journey.id, "RETURN_STARTED");
      const loc4 = await h.partnerClient.updateLocation(journey.id, { latitude: 12.982, longitude: 77.648 });
      assert.ok(loc4.targetDestination?.includes("Indiranagar"));

      // 5. IN_TRANSIT_TO_HOME
      await h.partnerClient.advanceMilestone(journey.id, "IN_TRANSIT_TO_HOME");
      const loc5 = await h.partnerClient.updateLocation(journey.id, { latitude: 12.975, longitude: 77.639 });
      assert.ok(loc5.targetDestination?.includes("Indiranagar"));
    } finally {
      await h.cleanup();
    }
  });

  await runTest("7. Stale location detection flags updates older than 60 seconds truthfully", async () => {
    const h = await createHarness();
    try {
      const hospitals = await h.patientClient.getHospitals();
      const journey = await h.patientClient.createBooking({
        pickupLocation: { latitude: 12.9784, longitude: 77.6408, address: "42 Indiranagar, Bengaluru" },
        hospitalDestination: hospitals[0],
      });

      await h.partnerClient.acceptJourney(journey.id);
      await h.partnerClient.advanceMilestone(journey.id, "PARTNER_EN_ROUTE");

      // Inject old timestamp location
      const oldTime = new Date(Date.now() - 120 * 1000).toISOString();
      const currentJourney = await h.store.journeys.findById(journey.id);
      currentJourney!.liveLocation = {
        latitude: 12.970,
        longitude: 77.635,
        updatedAt: oldTime,
        etaSeconds: 300,
        etaText: "5 mins",
        distanceMeters: 2000,
        distanceText: "2.0 km",
        isStale: false,
      };
      await h.store.journeys.save(currentJourney!);

      const result = await h.patientClient.getLiveLocation(journey.id);
      assert.ok(result.liveLocation);
      assert.equal(result.liveLocation?.isStale, true);
    } finally {
      await h.cleanup();
    }
  });

  await runTest("8. Tracking terminates and returns trackingActive=false when journey reaches COMPLETED state", async () => {
    const h = await createHarness();
    try {
      const hospitals = await h.patientClient.getHospitals();
      const journey = await h.patientClient.createBooking({
        pickupLocation: { latitude: 12.9784, longitude: 77.6408, address: "42 Indiranagar, Bengaluru" },
        hospitalDestination: hospitals[0],
      });

      await h.partnerClient.acceptJourney(journey.id);
      await h.partnerClient.advanceMilestone(journey.id, "PARTNER_EN_ROUTE");
      await h.partnerClient.advanceMilestone(journey.id, "PARTNER_ARRIVED");
      const fetched = await h.patientClient.getJourneyById(journey.id);
      await h.partnerClient.verifyPickupPin(journey.id, fetched!.pickupPin!);
      await h.partnerClient.advanceMilestone(journey.id, "IN_TRANSIT_TO_HOSPITAL");
      await h.partnerClient.advanceMilestone(journey.id, "ARRIVED_AT_HOSPITAL");
      await h.partnerClient.advanceMilestone(journey.id, "HOSPITAL_VISIT");
      await h.partnerClient.advanceMilestone(journey.id, "RETURN_STARTED");
      await h.partnerClient.advanceMilestone(journey.id, "IN_TRANSIT_TO_HOME");
      await h.partnerClient.advanceMilestone(journey.id, "PATIENT_RETURNED_HOME");
      await h.partnerClient.advanceMilestone(journey.id, "COMPLETED");

      const result = await h.patientClient.getLiveLocation(journey.id);
      assert.equal(result.trackingActive, false);
      assert.equal(result.liveLocation, null);
      assert.ok(result.message?.includes("stopped"));

      // Submitting location after completion must be rejected
      await assert.rejects(
        async () => {
          await h.partnerClient.updateLocation(journey.id, { latitude: 12.978, longitude: 77.640 });
        },
        (err: any) => err.status === 409 || err.code === "BOOKING_ALREADY_TERMINATED"
      );
    } finally {
      await h.cleanup();
    }
  });

  console.log("--------------------------------------------------");
  console.log(`TOTAL P1 LIVE LOCATION TESTS: ${testCount} | PASSED: ${passCount} | FAILED: ${testCount - passCount}`);
  console.log("ALL P1 LIVE LOCATION & ETA TESTS PASSED!");
  console.log("--------------------------------------------------\n");
}

runLiveLocationTestSuite().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
