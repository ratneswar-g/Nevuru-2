import assert from "node:assert/strict";
import http from "node:http";
import { PostgresDomainStore } from "../src/server/db/repositories/postgres-repositories.ts";
import { InMemoryRelationalDriver } from "../src/server/db/driver.ts";
import { JourneyService } from "../src/services/journey-service.ts";
import { createApiApp } from "../src/server/api/app.ts";
import { ServerAuthService } from "../src/server/auth/server-auth-service.ts";
import {
  DevelopmentConsoleOtpProvider,
  ConfiguredProductionSmsProvider,
} from "../src/server/auth/sms-provider.ts";
import { AuthUser } from "../src/auth/types.ts";

async function runSosEscalationTestSuite() {
  console.log("==================================================");
  console.log("NERAVU P1: SOS OPERATIONAL ESCALATION & NOTIFICATIONS TEST SUITE");
  console.log("==================================================");

  let testCount = 0;
  let passCount = 0;

  async function runTest(name: string, fn: () => Promise<void>) {
    testCount++;
    try {
      await fn();
      passCount++;
      console.log(`  ✓ [SOS TEST ${testCount}] ${name}`);
    } catch (err: any) {
      console.error(`  ✗ [SOS TEST ${testCount}] FAILED: ${name}`);
      console.error(err);
      process.exitCode = 1;
      throw err;
    }
  }

  // Set up test database, driver, and server
  const driver = new InMemoryRelationalDriver();
  const store = new PostgresDomainStore(driver);
  const authService = new ServerAuthService(store);
  const journeyService = new JourneyService(store);
  await journeyService.seedInitialDomainData();

  const app = createApiApp(journeyService, { authService });
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as any).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  // Identities
  const patient: AuthUser = {
    id: "dev-patient-001",
    name: "Aarav Sharma",
    phone: "+91 98765 43210",
    role: "PATIENT",
    status: "ACTIVE",
  };

  const otherPatient: AuthUser = {
    id: "dev-patient-999",
    name: "Sneha Patel",
    phone: "+91 98765 99999",
    role: "PATIENT",
    status: "ACTIVE",
  };

  const partner: AuthUser = {
    id: "dev-partner-001",
    name: "Ramesh Kumar",
    phone: "+91 98765 43211",
    role: "CARE_PARTNER",
    status: "ACTIVE",
  };

  const otherPartner: AuthUser = {
    id: "dev-partner-999",
    name: "Vikram Singh",
    phone: "+91 98765 88888",
    role: "CARE_PARTNER",
    status: "ACTIVE",
  };

  const familyContact: AuthUser = {
    id: "dev-family-001",
    name: "Priya Sharma",
    phone: "+91 98765 43212",
    role: "FAMILY_CONTACT",
    status: "ACTIVE",
  };

  const admin: AuthUser = {
    id: "dev-admin-001",
    name: "Ananya Iyer (Ops Admin)",
    phone: "+91 98765 43213",
    role: "ADMIN",
    status: "ACTIVE",
  };

  // Ensure users exist in store
  for (const u of [patient, otherPatient, partner, otherPartner, familyContact, admin]) {
    await store.users.save({
      id: u.id,
      name: u.name,
      phone: u.phone,
      role: u.role,
      status: u.status,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }

  // Ensure patient profile has configured trusted contacts
  await store.patientProfiles.save({
    userId: patient.id,
    homeAddress: {
      latitude: 12.9716,
      longitude: 77.5946,
      address: "104 Sunrise Apts, Indiranagar, Bengaluru",
    },
    mobilityAssistance: ["INDEPENDENT_WALKER"],
    nonClinicalAssistanceNotes: "Needs companion for hospital appointment",
    trustedContacts: [
      {
        id: "tc-001",
        patientId: patient.id,
        contactName: "Priya Sharma",
        contactPhone: "+91 98765 43212",
        relationship: "Daughter",
        permissionLevel: "FULL_STATUS",
      },
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  const hospital = (await journeyService.getHospitals())[0];

  try {
    // 1. SOS AUTHORIZATION TESTS
    await runTest("1. Patient can trigger SOS on their own active journey", async () => {
      const journey = await journeyService.createBooking(patient, {
        pickupLocation: { latitude: 12.9716, longitude: 77.5946, address: "Home Indiranagar" },
        hospitalDestination: hospital,
        bookingType: "ON_DEMAND",
      });
      const assigned = await journeyService.acceptJourney(partner, journey.id);

      const res = await fetch(`${baseUrl}/api/journeys/${assigned.id}/emergency`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-User-Id": patient.id,
          "X-Role": patient.role,
        },
        body: JSON.stringify({
          category: "MEDICAL_EMERGENCY",
          reason: "Patient reported severe dizziness",
        }),
      });

      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.success, true);
      assert.equal(data.journey.currentState, "EMERGENCY_ACTIVE");
      assert.equal(data.journey.emergencyLogs.length, 1);
      assert.equal(data.journey.emergencyLogs[0].category, "MEDICAL_EMERGENCY");
    });

    await runTest("2. Unrelated patient is blocked from triggering SOS (IDOR protection - HTTP 403)", async () => {
      // Find the active journey
      const active = await store.journeys.findActiveByPatientId(patient.id);
      assert(active);

      const res = await fetch(`${baseUrl}/api/journeys/${active.id}/emergency`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-User-Id": otherPatient.id,
          "X-Role": otherPatient.role,
        },
        body: JSON.stringify({ category: "SAFETY_CONCERN" }),
      });

      assert.equal(res.status, 403);
      const data = await res.json();
      assert.equal(data.error, "UNAUTHORIZED_ACTION");
    });

    await runTest("3. Assigned Care Partner can trigger SOS; unassigned Partner is rejected (HTTP 403)", async () => {
      // Resolve previous emergency so journey resumes
      const active = await store.journeys.findActiveByPatientId(patient.id);
      assert(active);
      await journeyService.resolveEmergency(admin, active.id, "Operational clearance: patient stable");

      // Advance to PARTNER_EN_ROUTE
      let current = await store.journeys.findById(active.id);
      if (current?.currentState === "MATCHING") {
        current = await journeyService.acceptJourney(partner, current.id);
      }
      const enRoute = await journeyService.advanceMilestone(partner, current!.id, "PARTNER_EN_ROUTE");

      // Unassigned partner attempts to trigger emergency
      const unauthRes = await fetch(`${baseUrl}/api/journeys/${enRoute.id}/emergency`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-User-Id": otherPartner.id,
          "X-Role": otherPartner.role,
        },
        body: JSON.stringify({ category: "ACCIDENT" }),
      });
      assert.equal(unauthRes.status, 403);

      // Assigned partner triggers emergency
      const authRes = await fetch(`${baseUrl}/api/journeys/${enRoute.id}/emergency`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-User-Id": partner.id,
          "X-Role": partner.role,
        },
        body: JSON.stringify({
          category: "SAFETY_CONCERN",
          reason: "Companion vehicle pulled to service lane due to tire puncture",
        }),
      });
      assert.equal(authRes.status, 200);
      const authData = await authRes.json();
      assert.equal(authData.journey.currentState, "EMERGENCY_ACTIVE");
    });

    await runTest("4. Family Contact is read-only and blocked from triggering SOS (HTTP 403)", async () => {
      const active = await store.journeys.findActiveByPatientId(patient.id);
      assert(active);

      const res = await fetch(`${baseUrl}/api/journeys/${active.id}/emergency`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-User-Id": familyContact.id,
          "X-Role": familyContact.role,
        },
        body: JSON.stringify({ category: "PATIENT_DISTRESS" }),
      });

      assert.equal(res.status, 403);
      const data = await res.json();
      assert.equal(data.error, "UNAUTHORIZED_ACTION");
    });

    // 2. DUPLICATE & IDEMPOTENCY PROTECTION
    await runTest("5. Repeated SOS requests on active emergency are idempotent and do not create duplicate incidents", async () => {
      const active = await store.journeys.findActiveByPatientId(patient.id);
      assert(active);
      assert.equal(active.currentState, "EMERGENCY_ACTIVE");
      const incidentCountBefore = active.emergencyLogs.length;

      // Second identical/duplicate SOS call from patient
      const res = await fetch(`${baseUrl}/api/journeys/${active.id}/emergency`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-User-Id": patient.id,
          "X-Role": patient.role,
        },
        body: JSON.stringify({
          category: "MEDICAL_EMERGENCY",
          reason: "Repeated button click",
        }),
      });

      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.success, true);
      assert.equal(data.journey.currentState, "EMERGENCY_ACTIVE");
      // Must NOT add duplicate incident to emergencyLogs
      assert.equal(data.journey.emergencyLogs.length, incidentCountBefore);

      // Verify audit log has EMERGENCY_DUPLICATE_SUPPRESSED
      const auditRows = await store.auditLogs.findByAction("EMERGENCY_DUPLICATE_SUPPRESSED");
      assert(auditRows.length >= 1);
    });

    // 3. CONTEXT PRESERVATION
    await runTest("6. Emergency incident preserves full context: patient, partner, locations, and journey state", async () => {
      const active = await store.journeys.findActiveByPatientId(patient.id);
      assert(active);
      const lastIncident = active.emergencyLogs[active.emergencyLogs.length - 1];
      assert(lastIncident);

      assert.equal(lastIncident.journeyId, active.id);
      assert.equal(lastIncident.status, "ACTIVE");
      assert(lastIncident.triggeredAt);
      assert(lastIncident.stateAtTrigger);
      assert(lastIncident.locationSnapshot);
      assert(lastIncident.destinationSnapshot);
      assert(lastIncident.returnDropoffSnapshot);
      assert.equal(lastIncident.category, "SAFETY_CONCERN");
    });

    // 4. NOTIFICATION DISPATCH
    await runTest("7. Notification dispatch sends alerts to trusted contacts and operations desk", async () => {
      DevelopmentConsoleOtpProvider.clearOutbox();

      // Resolve and move to ARRIVED_AT_HOSPITAL
      const active = await store.journeys.findActiveByPatientId(patient.id);
      assert(active);
      await journeyService.resolveEmergency(admin, active.id, "Tire repaired, vehicle cleared");

      let current = await journeyService.advanceMilestone(partner, active.id, "PARTNER_ARRIVED");
      current = await journeyService.verifyPickupPin(partner, current.id, current.pickupPin!);
      current = await journeyService.advanceMilestone(partner, current.id, "IN_TRANSIT_TO_HOSPITAL");

      // Set custom live location
      await journeyService.updateLiveLocation(partner, current.id, {
        latitude: 12.9600,
        longitude: 77.6100,
        heading: 90,
        speed: 35,
        accuracy: 5,
      });

      // Patient triggers SOS
      const emergencyJourney = await journeyService.triggerEmergency(patient, current.id, {
        category: "MEDICAL_EMERGENCY",
        reason: "Patient experiencing shortness of breath",
      });

      assert.equal(emergencyJourney.currentState, "EMERGENCY_ACTIVE");

      // Verify trusted contact received alert
      const familyPhone = familyContact.phone;
      const familyMsg = DevelopmentConsoleOtpProvider.getLastNotificationForPhone(familyPhone);
      assert(familyMsg, "Trusted contact must receive emergency notification");
      assert(familyMsg.includes("[NERAVU EMERGENCY ALERT]"));
      assert(familyMsg.includes("Aarav Sharma"));
      assert(familyMsg.includes("MEDICAL_EMERGENCY"));
      // Must not claim direct 112 dispatch integration
      assert(!familyMsg.toLowerCase().includes("112 dispatched"));

      // Verify operations admin received alert
      const adminPhone = admin.phone;
      const adminMsg = DevelopmentConsoleOtpProvider.getLastNotificationForPhone(adminPhone);
      assert(adminMsg, "Operations admin must receive emergency notification");
      assert(adminMsg.includes("[NERAVU OPS ALERT]"));
      assert(adminMsg.includes("Desk action required"));

      // Verify audit log has EMERGENCY_TRIGGERED
      const auditRows = await store.auditLogs.findByAction("EMERGENCY_TRIGGERED");
      assert(auditRows.length >= 1);
      const latestAudit = auditRows[0];
      assert.equal(latestAudit.metadata.category, "MEDICAL_EMERGENCY");
      assert(latestAudit.metadata.contactsNotifiedCount >= 2);
    });

    await runTest("8. Unconfigured notification provider in production degrades gracefully without error", async () => {
      // Create a service instance with a null notification provider (simulating unconfigured production)
      const mockUnconfiguredStore = new PostgresDomainStore(new InMemoryRelationalDriver());
      const testService = new JourneyService(mockUnconfiguredStore, null);

      const pUser = await mockUnconfiguredStore.users.save({
        id: "p-test-graceful",
        name: "Test Patient",
        phone: "+91 91000 00001",
        role: "PATIENT",
        status: "ACTIVE",
      });

      const cpUser = await mockUnconfiguredStore.users.save({
        id: "cp-test-graceful",
        name: "Test Partner",
        phone: "+91 91000 00002",
        role: "CARE_PARTNER",
        status: "ACTIVE",
      });

      const j = await testService.createBooking(pUser, {
        pickupLocation: { latitude: 12.9, longitude: 77.6, address: "Start" },
        hospitalDestination: hospital,
        bookingType: "ON_DEMAND",
      });
      const assigned = await testService.acceptJourney(cpUser, j.id);

      // Should not throw even with null notification provider
      const emg = await testService.triggerEmergency(pUser, assigned.id, {
        category: "OTHER",
        reason: "Graceful notification test",
      });
      assert.equal(emg.currentState, "EMERGENCY_ACTIVE");
    });

    // 5. ESCALATED & RESOLUTION
    await runTest("9. Emergency can be escalated to ESCALATED and audit logged", async () => {
      const active = await store.journeys.findActiveByPatientId(patient.id);
      assert(active);
      assert.equal(active.currentState, "EMERGENCY_ACTIVE");

      const res = await fetch(`${baseUrl}/api/journeys/${active.id}/emergency/escalate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-User-Id": admin.id,
          "X-Role": admin.role,
        },
        body: JSON.stringify({
          note: "Ops supervisor escalating to on-call manager; ambulance dialed directly via 112",
        }),
      });

      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.journey.currentState, "ESCALATED");

      // Verify audit log recorded
      const auditRows = await store.auditLogs.findByAction("EMERGENCY_ESCALATED");
      assert(auditRows.length >= 1);
    });

    await runTest("10. GET /api/journeys/:id/emergency provides secure access-controlled emergency data", async () => {
      const active = await store.journeys.findActiveByPatientId(patient.id);
      assert(active);

      // Unrelated user cannot view emergency (HTTP 403)
      const forbiddenRes = await fetch(`${baseUrl}/api/journeys/${active.id}/emergency`, {
        headers: {
          "X-User-Id": otherPatient.id,
          "X-Role": otherPatient.role,
        },
      });
      assert.equal(forbiddenRes.status, 403);

      // Patient can view emergency (HTTP 200)
      const allowedRes = await fetch(`${baseUrl}/api/journeys/${active.id}/emergency`, {
        headers: {
          "X-User-Id": patient.id,
          "X-Role": patient.role,
        },
      });
      assert.equal(allowedRes.status, 200);
      const allowedData = await allowedRes.json();
      assert.equal(allowedData.success, true);
      assert.equal(allowedData.isEmergencyActive, true);
      assert(Array.isArray(allowedData.emergencyLogs));
    });

  } finally {
    server.close();
  }

  console.log("--------------------------------------------------");
  console.log(`TOTAL P1 SOS TESTS: ${testCount} | PASSED: ${passCount} | FAILED: 0`);
  console.log("ALL P1 SOS OPERATIONAL ESCALATION TESTS PASSED!");
  console.log("--------------------------------------------------");
}

runSosEscalationTestSuite().catch((err) => {
  console.error(err);
  process.exit(1);
});
