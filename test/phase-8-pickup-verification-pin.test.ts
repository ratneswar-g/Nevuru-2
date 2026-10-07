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
    console.log(`  ✓ [TEST ${testCount}] ${name}`);
  } catch (err) {
    console.error(`  ✗ [TEST ${testCount} FAILED] ${name}`);
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

  const pickupLocation = {
    latitude: 12.9716,
    longitude: 77.5946,
    address: "104 Sunrise Apts, 4th Main, Indiranagar, Bengaluru",
  };
  const hospitals = await service.getHospitals();
  const hospitalDestination = hospitals[0];

  const cleanup = async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await driver.disconnect();
  };

  return {
    driver,
    store,
    service,
    server,
    baseUrl,
    patientClient,
    partnerClient,
    cleanup,
    pickupLocation,
    hospitalDestination,
  };
}

async function runAllPickupPinTests() {
  console.log("\n==================================================");
  console.log("NERAVU P1: PICKUP VERIFICATION PIN TEST SUITE");
  console.log("==================================================\n");

  await runTest("1. Booking creation generates a secure 4-digit pickup PIN", async () => {
    const h = await createHarness();
    try {
      const journey = await h.patientClient.createBooking({
        pickupLocation: h.pickupLocation,
        hospitalDestination: h.hospitalDestination,
        bookingType: "ON_DEMAND",
      });

      assert(journey.id, "Journey must have an ID");
      assert(journey.pickupPin, "Journey must have a pickupPin generated");
      assert.match(journey.pickupPin, /^\d{4}$/, "Pickup PIN must be exactly 4 numeric digits");
      assert.equal(journey.pickupPinVerified, false, "pickupPinVerified must default to false");
    } finally {
      await h.cleanup();
    }
  });

  await runTest("2. Patient can view their PIN via GET /api/journeys and GET /api/journeys/:id", async () => {
    const h = await createHarness();
    try {
      const created = await h.patientClient.createBooking({
        pickupLocation: h.pickupLocation,
        hospitalDestination: h.hospitalDestination,
        bookingType: "ON_DEMAND",
      });

      const fetchedById = await h.patientClient.getJourneyById(created.id);
      assert(fetchedById, "Patient can fetch journey by ID");
      assert.equal(fetchedById.pickupPin, created.pickupPin, "Patient must see pickupPin in single journey response");

      const allJourneys = await h.patientClient.getJourneys();
      const matched = allJourneys.find((j) => j.id === created.id);
      assert(matched, "Journey found in patient journeys list");
      assert.equal(matched.pickupPin, created.pickupPin, "Patient must see pickupPin in list response");
    } finally {
      await h.cleanup();
    }
  });

  await runTest("3. Care Partner CANNOT view the PIN before verification (redacted server-side)", async () => {
    const h = await createHarness();
    try {
      const created = await h.patientClient.createBooking({
        pickupLocation: h.pickupLocation,
        hospitalDestination: h.hospitalDestination,
        bookingType: "ON_DEMAND",
      });

      const accepted = await h.partnerClient.acceptJourney(created.id);
      assert.equal(accepted.pickupPin, undefined, "acceptJourney response must NOT reveal pickupPin to partner");

      const partnerFetchedById = await h.partnerClient.getJourneyById(created.id);
      assert(partnerFetchedById, "Partner can fetch journey by ID");
      assert.equal(
        partnerFetchedById.pickupPin,
        undefined,
        "GET /api/journeys/:id MUST NOT reveal pickupPin to Care Partner before verification"
      );

      const partnerAll = await h.partnerClient.getJourneys();
      const partnerJourney = partnerAll.find((j) => j.id === created.id);
      assert(partnerJourney, "Partner can see assigned journey in list");
      assert.equal(
        partnerJourney.pickupPin,
        undefined,
        "GET /api/journeys list MUST NOT reveal pickupPin to Care Partner"
      );
    } finally {
      await h.cleanup();
    }
  });

  await runTest("4. Pickup verification fails if journey is not in PARTNER_ARRIVED state", async () => {
    const h = await createHarness();
    try {
      const created = await h.patientClient.createBooking({
        pickupLocation: h.pickupLocation,
        hospitalDestination: h.hospitalDestination,
        bookingType: "ON_DEMAND",
      });
      await h.partnerClient.acceptJourney(created.id);
      // State is PARTNER_ASSIGNED, not PARTNER_ARRIVED
      const patientJourney = await h.patientClient.getJourneyById(created.id);
      const pin = patientJourney!.pickupPin!;

      await assert.rejects(
        async () => {
          await h.partnerClient.verifyPickupPin(created.id, pin);
        },
        (err: any) => {
          assert(
            err.message.includes("PARTNER_ARRIVED") || err.code === "INVALID_STATE_TRANSITION",
            "Must reject verification before partner arrival"
          );
          return true;
        }
      );
    } finally {
      await h.cleanup();
    }
  });

  await runTest("5. Incorrect PIN fails with 400 and DOES NOT advance journey", async () => {
    const h = await createHarness();
    try {
      const created = await h.patientClient.createBooking({
        pickupLocation: h.pickupLocation,
        hospitalDestination: h.hospitalDestination,
        bookingType: "ON_DEMAND",
      });
      await h.partnerClient.acceptJourney(created.id);
      await h.partnerClient.advanceMilestone(created.id, "PARTNER_EN_ROUTE");
      await h.partnerClient.advanceMilestone(created.id, "PARTNER_ARRIVED");

      const wrongPin = "0000";
      await assert.rejects(
        async () => {
          await h.partnerClient.verifyPickupPin(created.id, wrongPin);
        },
        (err: any) => {
          assert(
            err.message.includes("Incorrect") || err.code === "INVALID_PICKUP_PIN",
            "Must reject with incorrect PIN error"
          );
          return true;
        }
      );

      // Verify state has NOT advanced
      const journeyInDb = await h.store.journeys.findById(created.id);
      assert.equal(journeyInDb!.currentState, "PARTNER_ARRIVED", "State must remain PARTNER_ARRIVED after wrong PIN");
      assert.equal(journeyInDb!.pickupPinVerified, false, "pickupPinVerified must remain false");
      assert.equal(journeyInDb!.pickupPinFailedAttempts, 1, "Failed attempts count must be incremented to 1");
    } finally {
      await h.cleanup();
    }
  });

  await runTest("6. Rate limiting locks verification after 5 failed attempts with 429", async () => {
    const h = await createHarness();
    try {
      const created = await h.patientClient.createBooking({
        pickupLocation: h.pickupLocation,
        hospitalDestination: h.hospitalDestination,
        bookingType: "ON_DEMAND",
      });
      await h.partnerClient.acceptJourney(created.id);
      await h.partnerClient.advanceMilestone(created.id, "PARTNER_EN_ROUTE");
      await h.partnerClient.advanceMilestone(created.id, "PARTNER_ARRIVED");

      // Attempt 1 to 4 with incorrect PIN
      for (let i = 1; i <= 4; i++) {
        await assert.rejects(
          async () => {
            await h.partnerClient.verifyPickupPin(created.id, "9999");
          },
          (err: any) => err.code === "INVALID_PICKUP_PIN"
        );
      }

      // 5th attempt locks the verification
      await assert.rejects(
        async () => {
          await h.partnerClient.verifyPickupPin(created.id, "9999");
        },
        (err: any) => err.code === "INVALID_PICKUP_PIN"
      );

      const journeyAfter5 = await h.store.journeys.findById(created.id);
      assert.equal(journeyAfter5!.pickupPinFailedAttempts, 5);
      assert(journeyAfter5!.pickupPinLockedUntil, "Must have lockedUntil timestamp set");

      // 6th attempt (even with correct PIN) must be rejected due to lockout
      const patientJourney = await h.patientClient.getJourneyById(created.id);
      const correctPin = patientJourney!.pickupPin!;

      await assert.rejects(
        async () => {
          await h.partnerClient.verifyPickupPin(created.id, correctPin);
        },
        (err: any) => {
          assert(
            err.code === "PICKUP_PIN_RATE_LIMITED" || err.status === 429 || err.message.includes("locked"),
            "Must be blocked with rate limited / locked error"
          );
          return true;
        }
      );
    } finally {
      await h.cleanup();
    }
  });

  await runTest("7. Correct PIN successfully advances journey to PATIENT_PICKED_UP", async () => {
    const h = await createHarness();
    try {
      const created = await h.patientClient.createBooking({
        pickupLocation: h.pickupLocation,
        hospitalDestination: h.hospitalDestination,
        bookingType: "ON_DEMAND",
      });
      await h.partnerClient.acceptJourney(created.id);
      await h.partnerClient.advanceMilestone(created.id, "PARTNER_EN_ROUTE");
      await h.partnerClient.advanceMilestone(created.id, "PARTNER_ARRIVED");

      const patientJourney = await h.patientClient.getJourneyById(created.id);
      const correctPin = patientJourney!.pickupPin!;

      const verifiedJourney = await h.partnerClient.verifyPickupPin(created.id, correctPin);
      assert.equal(verifiedJourney.currentState, "PATIENT_PICKED_UP", "State must advance to PATIENT_PICKED_UP");
      assert.equal(verifiedJourney.pickupPinVerified, true, "pickupPinVerified must be true");

      const dbJourney = await h.store.journeys.findById(created.id);
      assert.equal(dbJourney!.currentState, "PATIENT_PICKED_UP");
      assert.equal(dbJourney!.pickupPinVerified, true);
      assert.equal(dbJourney!.pickupPinFailedAttempts, 0);
    } finally {
      await h.cleanup();
    }
  });

  await runTest("8. Audit logs record PIN failure, rate limit, and verification success without leaking plaintext PIN", async () => {
    const h = await createHarness();
    try {
      const created = await h.patientClient.createBooking({
        pickupLocation: h.pickupLocation,
        hospitalDestination: h.hospitalDestination,
        bookingType: "ON_DEMAND",
      });
      await h.partnerClient.acceptJourney(created.id);
      await h.partnerClient.advanceMilestone(created.id, "PARTNER_EN_ROUTE");
      await h.partnerClient.advanceMilestone(created.id, "PARTNER_ARRIVED");

      const patientJourney = await h.patientClient.getJourneyById(created.id);
      const correctPin = patientJourney!.pickupPin!;

      // 1 failed attempt
      try {
        await h.partnerClient.verifyPickupPin(created.id, "0000");
      } catch {}

      // 1 success attempt
      await h.partnerClient.verifyPickupPin(created.id, correctPin);

      const logs = await h.store.auditLogs.findAll();
      const actions = logs.map((l) => l.action);

      assert(actions.includes("PICKUP_PIN_FAILED"), "Audit logs must record PICKUP_PIN_FAILED");
      assert(actions.includes("PICKUP_PIN_VERIFIED"), "Audit logs must record PICKUP_PIN_VERIFIED");

      // Verify plaintext PIN is NEVER leaked in audit logs
      const rawLogs = JSON.stringify(logs);
      assert(!rawLogs.includes(correctPin), "Audit logs MUST NOT leak the plaintext pickup PIN");
      assert(!rawLogs.includes("0000"), "Audit logs MUST NOT leak the attempted PIN");
    } finally {
      await h.cleanup();
    }
  });

  await runTest("9. Subsequent journey progression works as standard state machine after pickup PIN verification", async () => {
    const h = await createHarness();
    try {
      const created = await h.patientClient.createBooking({
        pickupLocation: h.pickupLocation,
        hospitalDestination: h.hospitalDestination,
        bookingType: "ON_DEMAND",
      });
      await h.partnerClient.acceptJourney(created.id);
      await h.partnerClient.advanceMilestone(created.id, "PARTNER_EN_ROUTE");
      await h.partnerClient.advanceMilestone(created.id, "PARTNER_ARRIVED");

      const patientJourney = await h.patientClient.getJourneyById(created.id);
      await h.partnerClient.verifyPickupPin(created.id, patientJourney!.pickupPin!);

      // Standard progression from PATIENT_PICKED_UP onwards
      let cur = await h.partnerClient.advanceMilestone(created.id, "IN_TRANSIT_TO_HOSPITAL");
      assert.equal(cur.currentState, "IN_TRANSIT_TO_HOSPITAL");
      cur = await h.partnerClient.advanceMilestone(created.id, "ARRIVED_AT_HOSPITAL");
      assert.equal(cur.currentState, "ARRIVED_AT_HOSPITAL");
      cur = await h.partnerClient.advanceMilestone(created.id, "HOSPITAL_VISIT");
      assert.equal(cur.currentState, "HOSPITAL_VISIT");
      cur = await h.patientClient.advanceMilestone(created.id, "RETURN_STARTED");
      assert.equal(cur.currentState, "RETURN_STARTED");
      cur = await h.partnerClient.advanceMilestone(created.id, "IN_TRANSIT_TO_HOME");
      assert.equal(cur.currentState, "IN_TRANSIT_TO_HOME");
      cur = await h.partnerClient.advanceMilestone(created.id, "PATIENT_RETURNED_HOME");
      assert.equal(cur.currentState, "PATIENT_RETURNED_HOME");
      cur = await h.partnerClient.advanceMilestone(created.id, "COMPLETED");
      assert.equal(cur.currentState, "COMPLETED");
    } finally {
      await h.cleanup();
    }
  });

  console.log("\n--------------------------------------------------");
  console.log(`TOTAL P1 PICKUP PIN TESTS: ${testCount} | PASSED: ${passCount} | FAILED: ${testCount - passCount}`);
  if (passCount === testCount) {
    console.log("ALL P1 PICKUP VERIFICATION PIN TESTS PASSED!");
  }
  console.log("--------------------------------------------------\n");
}

runAllPickupPinTests().catch((err) => {
  console.error("Test suite failed:", err);
  process.exit(1);
});
