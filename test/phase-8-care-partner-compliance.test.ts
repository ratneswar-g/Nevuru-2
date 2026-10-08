import assert from 'node:assert/strict';
import { InMemoryRelationalDriver } from '../src/server/db/driver.ts';
import { PostgresDomainStore } from '../src/server/db/repositories/postgres-repositories.ts';
import { runMigrations } from '../src/server/db/migrate.ts';
import { JourneyService } from '../src/services/journey-service.ts';
import { createApiApp } from '../src/server/api/app.ts';
import { NeravuApiClient } from '../src/services/api-client.ts';
import { DEV_IDENTITIES } from '../src/auth/development-auth.ts';
import {
  evaluateCarePartnerCompliance,
  isDocumentExpired,
  validateComplianceDocumentInput,
} from '../src/domain/care-partner/compliance.ts';
import { CarePartnerProfile } from '../src/domain/types/care-partner.ts';

let testCount = 0;
let passCount = 0;

async function runTest(name: string, fn: () => Promise<void>) {
  testCount++;
  try {
    await fn();
    passCount++;
    console.log(`  ✓ [COMPLIANCE TEST ${testCount}] ${name}`);
  } catch (err) {
    console.error(`  ✗ [COMPLIANCE TEST ${testCount} FAILED] ${name}`);
    console.error(err);
    throw err;
  }
}

async function createHarness() {
  process.env.NODE_ENV = 'test';
  const driver = new InMemoryRelationalDriver();
  await driver.connect();
  await runMigrations(driver);
  const store = new PostgresDomainStore(driver);
  const service = new JourneyService(store);
  await service.seedInitialDomainData();
  const app = createApiApp(service);

  let server: any;
  let baseUrl = '';
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
  });

  const patient = DEV_IDENTITIES.PATIENT;
  const partner = DEV_IDENTITIES.CARE_PARTNER;
  const family = DEV_IDENTITIES.FAMILY_CONTACT;
  const admin = DEV_IDENTITIES.ADMIN;

  const patientClient = new NeravuApiClient({
    baseUrl,
    getAuthToken: () => `dev-session-${patient.id}`,
    getUserId: () => patient.id,
    getRole: () => 'PATIENT',
  });

  const partnerClient = new NeravuApiClient({
    baseUrl,
    getAuthToken: () => `dev-session-${partner.id}`,
    getUserId: () => partner.id,
    getRole: () => 'CARE_PARTNER',
  });

  const familyClient = new NeravuApiClient({
    baseUrl,
    getAuthToken: () => `dev-session-${family.id}`,
    getUserId: () => family.id,
    getRole: () => 'FAMILY_CONTACT',
  });

  const adminClient = new NeravuApiClient({
    baseUrl,
    getAuthToken: () => `dev-session-${admin.id}`,
    getUserId: () => admin.id,
    getRole: () => 'ADMIN',
  });

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
    patient,
    partner,
    admin,
    family,
    patientClient,
    partnerClient,
    familyClient,
    adminClient,
    cleanup,
  };
}

async function runAllComplianceTests() {
  console.log('==================================================');
  console.log('NERAVU P1: CARE PARTNER COMPLIANCE TEST SUITE');
  console.log('==================================================');

  // TEST 1: Document creation and update
  await runTest('1. Document creation and update test (DL, insurance, fitness certificate)', async () => {
    const harness = await createHarness();
    try {
      const partnerId = harness.partner.id;

      // Care partner submits driving licence
      const dlRes = await harness.partnerClient.submitComplianceDocument(partnerId, {
        type: 'DRIVING_LICENCE',
        documentNumber: 'KA-01-20210019283',
        issueDate: '2021-05-10',
        expiryDate: '2031-05-09',
      });

      assert.equal(dlRes.document.type, 'DRIVING_LICENCE');
      assert.equal(dlRes.document.documentNumber, 'KA-01-20210019283');
      assert.equal(dlRes.document.status, 'PENDING');
      assert.ok(dlRes.document.id);
      assert.ok(dlRes.document.createdAt);

      // Care partner submits vehicle insurance
      const viRes = await harness.partnerClient.submitComplianceDocument(partnerId, {
        type: 'VEHICLE_INSURANCE',
        documentNumber: 'POL-ICICI-9928172',
        issueDate: '2025-01-01',
        expiryDate: '2027-01-01',
      });
      assert.equal(viRes.document.type, 'VEHICLE_INSURANCE');
      assert.equal(viRes.document.status, 'PENDING');

      // Care partner submits commercial fitness certificate
      const fcRes = await harness.partnerClient.submitComplianceDocument(partnerId, {
        type: 'COMMERCIAL_FITNESS_CERTIFICATE',
        documentNumber: 'FC-KA03-2024-8819',
        issueDate: '2024-06-01',
        expiryDate: '2027-06-01',
      });
      assert.equal(fcRes.document.type, 'COMMERCIAL_FITNESS_CERTIFICATE');
      assert.equal(fcRes.document.status, 'PENDING');

      // Admin reviews and verifies documents
      const verifiedDL = await harness.adminClient.reviewComplianceDocument(partnerId, dlRes.document.id, {
        status: 'VERIFIED',
      });
      assert.equal(verifiedDL.document.status, 'VERIFIED');
      assert.ok(verifiedDL.document.verifiedAt);
      assert.equal(verifiedDL.document.verifiedByAdminId, harness.admin.id);

      await harness.adminClient.reviewComplianceDocument(partnerId, viRes.document.id, {
        status: 'VERIFIED',
      });
      const verifiedFC = await harness.adminClient.reviewComplianceDocument(partnerId, fcRes.document.id, {
        status: 'VERIFIED',
      });

      // Overall compliance status should now be COMPLIANT
      assert.equal(verifiedFC.summary.isCompliant, true);
      assert.equal(verifiedFC.summary.overallStatus, 'COMPLIANT');
      assert.equal(verifiedFC.summary.missingDocumentTypes.length, 0);
      assert.equal(verifiedFC.summary.pendingDocumentTypes.length, 0);
    } finally {
      await harness.cleanup();
    }
  });

  // TEST 2: Expiry validation test
  await runTest('2. Expiry validation test (identifies expired documents and flags non-compliance)', async () => {
    const harness = await createHarness();
    try {
      const partnerId = harness.partner.id;

      // Submit an already-expired vehicle insurance
      const expiredDate = '2023-01-01';
      const viRes = await harness.partnerClient.submitComplianceDocument(partnerId, {
        type: 'VEHICLE_INSURANCE',
        documentNumber: 'POL-EXPIRED-1234',
        issueDate: '2022-01-01',
        expiryDate: expiredDate,
      });

      // Verify helper function
      const isExp = isDocumentExpired(viRes.document);
      assert.equal(isExp, true);

      // Verify compliance summary reflects expired status
      const summary = await harness.partnerClient.getCarePartnerCompliance(partnerId);
      assert.ok(summary.expiredDocumentTypes.includes('VEHICLE_INSURANCE'));
      assert.equal(summary.overallStatus, 'NON_COMPLIANT');
      assert.equal(summary.isCompliant, false);

      // Check input validation rejection for invalid date format or future issue date
      const invalidInput = validateComplianceDocumentInput({
        type: 'DRIVING_LICENCE',
        documentNumber: 'KA123',
        issueDate: '2026-10-01',
        expiryDate: '2025-10-01', // Issue date later than expiry date
      });
      assert.equal(invalidInput.valid, false);
      assert.ok(invalidInput.error?.includes('Issue date cannot be later than expiry date'));
    } finally {
      await harness.cleanup();
    }
  });

  // TEST 3: Care Partner eligibility test
  await runTest('3. Care Partner eligibility test (expired mandatory documents block new journeys; active journeys preserved)', async () => {
    const harness = await createHarness();
    try {
      const partnerId = harness.partner.id;
      const patientId = harness.patient.id;

      // Submit expired driving licence
      await harness.partnerClient.submitComplianceDocument(partnerId, {
        type: 'DRIVING_LICENCE',
        documentNumber: 'DL-EXPIRED-999',
        expiryDate: '2020-01-01',
      });

      // Availability check: findAvailable must exclude this partner
      const availablePartners = await harness.store.carePartners.findAvailable();
      const found = availablePartners.find((p) => p.userId === partnerId);
      assert.equal(found, undefined, 'Partner with expired mandatory document must not be listed as available');

      // Create a journey in MATCHING state
      const hospitals = await harness.service.getHospitals();
      const booking = await harness.service.createBooking(harness.patient, {
        pickupLocation: {
          latitude: 12.9716,
          longitude: 77.5946,
          address: '104 Indiranagar, Bengaluru',
        },
        hospitalDestination: hospitals[0],
      });

      // Partner attempts to accept journey -> must be rejected with server-authoritative error
      let blockedError: any = null;
      try {
        await harness.partnerClient.acceptJourney(booking.id);
      } catch (err: any) {
        blockedError = err;
      }

      assert.ok(blockedError, 'Accepting journey must fail when mandatory document is expired');
      assert.ok(
        blockedError.message.includes('expired') ||
          blockedError.message.includes('CARE_PARTNER_DOCUMENTS_EXPIRED') ||
          blockedError.message.includes('NON_COMPLIANT')
      );

      // Invariant: Existing active journeys must NOT be cancelled or corrupted if a document later expires
      // Setup a valid active journey first
      // Update partner document to valid temporarily to accept journey
      await harness.partnerClient.submitComplianceDocument(partnerId, {
        type: 'DRIVING_LICENCE',
        documentNumber: 'DL-VALID-2030',
        expiryDate: '2030-01-01',
      });
      await harness.partnerClient.submitComplianceDocument(partnerId, {
        type: 'VEHICLE_INSURANCE',
        documentNumber: 'VI-VALID-2030',
        expiryDate: '2030-01-01',
      });
      await harness.partnerClient.submitComplianceDocument(partnerId, {
        type: 'COMMERCIAL_FITNESS_CERTIFICATE',
        documentNumber: 'FC-VALID-2030',
        expiryDate: '2030-01-01',
      });

      // Admin verifies them
      const comp = await harness.partnerClient.getCarePartnerCompliance(partnerId);
      for (const d of comp.documents) {
        await harness.adminClient.reviewComplianceDocument(partnerId, d.id, { status: 'VERIFIED' });
      }

      // Now accept journey successfully
      const acceptedJourney = await harness.partnerClient.acceptJourney(booking.id);
      assert.equal(acceptedJourney.currentState, 'PARTNER_ASSIGNED');

      // Now simulate a document expiring mid-journey (e.g. Insurance expires)
      await harness.partnerClient.submitComplianceDocument(partnerId, {
        type: 'VEHICLE_INSURANCE',
        documentNumber: 'VI-NOW-EXPIRED',
        expiryDate: '2020-01-01',
      });

      // Invariant: The active journey can still advance milestones to completion without being forcibly cancelled!
      const enRoute = await harness.partnerClient.advanceMilestone(
        booking.id,
        'PARTNER_EN_ROUTE',
        'Navigating to patient residence'
      );
      assert.equal(enRoute.currentState, 'PARTNER_EN_ROUTE');

      const arrived = await harness.partnerClient.advanceMilestone(
        booking.id,
        'PARTNER_ARRIVED',
        'Arrived at patient gate'
      );
      assert.equal(arrived.currentState, 'PARTNER_ARRIVED');
    } finally {
      await harness.cleanup();
    }
  });

  // TEST 4: RBAC and authorization test
  await runTest('4. RBAC and authorization test (Partner & Admin permitted, Patient & Family blocked, Admin-only verification)', async () => {
    const harness = await createHarness();
    try {
      const partnerId = harness.partner.id;

      // Patient attempting to view partner compliance summary -> 403 Forbidden
      let patientBlocked = false;
      try {
        await harness.patientClient.getCarePartnerCompliance(partnerId);
      } catch (err: any) {
        patientBlocked = true;
        assert.equal(err.status, 403);
      }
      assert.equal(patientBlocked, true, 'Patient must receive 403 when requesting partner compliance');

      // Family contact attempting to submit partner document -> 403 Forbidden
      let familyBlocked = false;
      try {
        await harness.familyClient.submitComplianceDocument(partnerId, {
          type: 'DRIVING_LICENCE',
          documentNumber: 'DL-UNAUTH-111',
          expiryDate: '2028-01-01',
        });
      } catch (err: any) {
        familyBlocked = true;
        assert.equal(err.status, 403);
      }
      assert.equal(familyBlocked, true, 'Family contact must receive 403 when attempting to submit document');

      // Care partner submitting their own document -> Succeeds
      const doc = await harness.partnerClient.submitComplianceDocument(partnerId, {
        type: 'DRIVING_LICENCE',
        documentNumber: 'DL-PARTNER-AUTH',
        expiryDate: '2029-01-01',
      });
      assert.ok(doc.document.id);

      // Care partner attempting to verify their own document -> 403 Forbidden
      let partnerSelfVerifyBlocked = false;
      try {
        await harness.partnerClient.reviewComplianceDocument(partnerId, doc.document.id, {
          status: 'VERIFIED',
        });
      } catch (err: any) {
        partnerSelfVerifyBlocked = true;
        assert.equal(err.status, 403);
      }
      assert.equal(partnerSelfVerifyBlocked, true, 'Partner cannot verify their own document; only Admin permitted');

      // Admin reviewing document -> Succeeds
      const adminVerified = await harness.adminClient.reviewComplianceDocument(partnerId, doc.document.id, {
        status: 'VERIFIED',
      });
      assert.equal(adminVerified.document.status, 'VERIFIED');
    } finally {
      await harness.cleanup();
    }
  });

  // TEST 5: Patient privacy test
  await runTest('5. Patient privacy test (documents sanitized from GET /api/users/care-partner/:id for non-privileged callers)', async () => {
    const harness = await createHarness();
    try {
      const partnerId = harness.partner.id;

      // Add documents
      await harness.partnerClient.submitComplianceDocument(partnerId, {
        type: 'DRIVING_LICENCE',
        documentNumber: 'SENSITIVE-DL-SECRET-888',
        expiryDate: '2030-01-01',
      });

      // Patient views partner profile
      const patientView = await harness.patientClient.getCarePartnerProfile(partnerId);
      assert.ok(patientView, 'Patient should be able to view basic partner profile');
      assert.equal(
        (patientView as any).documents,
        undefined,
        'Sensitive documents MUST be stripped from patient view'
      );
      assert.ok(patientView.vehicle, 'Vehicle details remain visible for passenger safety');
      assert.ok(patientView.verificationStatus, 'Verification badge remains visible');

      // Care Partner views their own profile -> documents included
      const partnerSelfView = await harness.partnerClient.getCarePartnerProfile(partnerId);
      assert.ok(partnerSelfView.documents, 'Care Partner should be able to view their own documents');
      assert.ok(partnerSelfView.documents.length >= 1);
      const hasSubmittedDl = partnerSelfView.documents.some((d: any) => d.documentNumber === 'SENSITIVE-DL-SECRET-888');
      assert.equal(hasSubmittedDl, true);
    } finally {
      await harness.cleanup();
    }
  });

  // TEST 6: Audit logging test
  await runTest('6. Audit logging test (records document submissions and reviews with masked references)', async () => {
    const harness = await createHarness();
    try {
      const partnerId = harness.partner.id;

      // Submit document
      const subRes = await harness.partnerClient.submitComplianceDocument(partnerId, {
        type: 'DRIVING_LICENCE',
        documentNumber: 'KA032021008899',
        expiryDate: '2031-01-01',
      });

      // Review document
      await harness.adminClient.reviewComplianceDocument(partnerId, subRes.document.id, {
        status: 'VERIFIED',
      });

      // Inspect audit logs in database
      const auditRows = await harness.driver.query("SELECT * FROM audit_logs WHERE entity_type = 'care_partner_document'");
      assert.ok(auditRows.length >= 2, 'Must have at least 2 audit entries for submission and review');

      const submitLog = auditRows.find((r: any) => r.action === 'COMPLIANCE_DOCUMENT_SUBMITTED');
      assert.ok(submitLog, 'Must record COMPLIANCE_DOCUMENT_SUBMITTED audit log');
      const submitMeta = typeof submitLog.metadata === 'string' ? JSON.parse(submitLog.metadata) : submitLog.metadata;
      assert.equal(submitMeta.carePartnerId, partnerId);
      assert.equal(submitMeta.documentType, 'DRIVING_LICENCE');
      // Document reference should be masked, never storing plain full secret number
      assert.ok(submitMeta.documentReference.startsWith('***'));

      const reviewLog = auditRows.find((r: any) => r.action === 'COMPLIANCE_DOCUMENT_REVIEWED');
      assert.ok(reviewLog, 'Must record COMPLIANCE_DOCUMENT_REVIEWED audit log');
      const reviewMeta = typeof reviewLog.metadata === 'string' ? JSON.parse(reviewLog.metadata) : reviewLog.metadata;
      assert.equal(reviewMeta.reviewStatus, 'VERIFIED');
      assert.equal(reviewMeta.adminId, harness.admin.id);
    } finally {
      await harness.cleanup();
    }
  });

  // TEST 7: Duplicate-data and integrity test
  await runTest('7. Duplicate-data & integrity test (resubmission updates existing document of same type, vehicle info preserved)', async () => {
    const harness = await createHarness();
    try {
      const partnerId = harness.partner.id;

      // Initial profile
      const initialProfile = await harness.service.getCarePartnerProfile(partnerId);
      assert.ok(initialProfile);
      const originalVehicle = { ...initialProfile.vehicle };

      // Submit first DL
      const doc1 = await harness.partnerClient.submitComplianceDocument(partnerId, {
        type: 'DRIVING_LICENCE',
        documentNumber: 'DL-ORIGINAL-001',
        expiryDate: '2026-12-31',
      });

      // Submit renewed DL of same type
      const doc2 = await harness.partnerClient.submitComplianceDocument(partnerId, {
        type: 'DRIVING_LICENCE',
        documentNumber: 'DL-RENEWED-002',
        expiryDate: '2036-12-31',
      });

      // Verify no duplicate: only 1 DRIVING_LICENCE document exists on profile
      const profileAfter = await harness.service.getCarePartnerProfile(partnerId);
      assert.ok(profileAfter);
      const dlDocs = profileAfter.documents?.filter((d) => d.type === 'DRIVING_LICENCE') || [];
      assert.equal(dlDocs.length, 1, 'Duplicate document types must NOT be appended; must update in-place');
      assert.equal(dlDocs[0].documentNumber, 'DL-RENEWED-002');
      assert.equal(dlDocs[0].expiryDate, '2036-12-31');
      assert.equal(dlDocs[0].status, 'PENDING');

      // Vehicle and existing profile fields must be fully preserved
      assert.equal(profileAfter.vehicle?.licensePlate, originalVehicle.licensePlate);
      assert.equal(profileAfter.vehicle?.model, originalVehicle.model);
      assert.equal(profileAfter.userId, partnerId);
    } finally {
      await harness.cleanup();
    }
  });

  console.log('--------------------------------------------------');
  console.log(`TOTAL COMPLIANCE TESTS: ${testCount} | PASSED: ${passCount} | FAILED: ${testCount - passCount}`);
  console.log('ALL P1 CARE PARTNER COMPLIANCE TESTS PASSED!');
  console.log('--------------------------------------------------');
}

runAllComplianceTests().catch((err) => {
  console.error('Compliance test suite failed:', err);
  process.exit(1);
});
