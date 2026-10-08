import assert from 'node:assert/strict';
import { InMemoryRelationalDriver } from '../src/server/db/driver.ts';
import { PostgresDomainStore } from '../src/server/db/repositories/postgres-repositories.ts';
import { runMigrations } from '../src/server/db/migrate.ts';
import { JourneyService } from '../src/services/journey-service.ts';
import { PaymentService } from '../src/services/payment-service.ts';
import {
  SandboxPaymentProvider,
  RazorpayPaymentProvider,
} from '../src/services/payment/payment-gateway-adapter.ts';
import { createApiApp } from '../src/server/api/app.ts';
import { NeravuApiClient, ApiError } from '../src/services/api-client.ts';
import { DEV_IDENTITIES } from '../src/auth/development-auth.ts';

let testCount = 0;
let passCount = 0;

async function runTest(name: string, fn: () => Promise<void>) {
  testCount++;
  try {
    await fn();
    passCount++;
    console.log(`  ✓ [PAYMENT TEST ${testCount}] ${name}`);
  } catch (err) {
    console.error(`  ✗ [PAYMENT TEST ${testCount} FAILED] ${name}`);
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

  const paymentService = new PaymentService(store, new SandboxPaymentProvider());
  const app = createApiApp(service, { paymentService });

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

  // Client for a distinct patient (for IDOR / privacy checks)
  const otherPatientId = 'dev-patient-other-99';
  const otherPatientClient = new NeravuApiClient({
    baseUrl,
    getAuthToken: () => `dev-session-${otherPatientId}`,
    getUserId: () => otherPatientId,
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

  const unauthenticatedClient = new NeravuApiClient({
    baseUrl,
    getAuthToken: () => null,
  });

  const cleanup = async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await driver.disconnect();
  };

  return {
    baseUrl,
    driver,
    store,
    service,
    paymentService,
    patient,
    partner,
    family,
    admin,
    patientClient,
    otherPatientClient,
    partnerClient,
    familyClient,
    adminClient,
    unauthenticatedClient,
    cleanup,
  };
}

async function runAllPaymentTests() {
  console.log('\n======================================================');
  console.log('NERAVU COMMERCIAL PAYMENT GATEWAY VALIDATION TEST SUITE');
  console.log('======================================================\n');

  const harness = await createHarness();

  try {
    // Helper: create an active booking
    const hosp = (await harness.service.getHospitals())[0];
    const profile = await harness.service.getPatientProfile(harness.patient.id);

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
        pickupLocation: profile.homeAddress,
        hospitalDestination: hosp,
        bookingType: 'ON_DEMAND',
      });
    };

    const booking = await createFreshBooking();

    // ----------------------------------------------------
    // TEST 1: Server-Authoritative Amount Test
    // ----------------------------------------------------
    await runTest('1. Server-authoritative amount: Derived exclusively from booking fare estimate', async () => {
      assert.ok(booking.fareEstimate, 'Journey must have server-calculated fareEstimate snapshot');
      const expectedTotal = Math.round(booking.fareEstimate.total ?? booking.fareEstimate.totalEstimatedFare ?? 0);
      assert.ok(expectedTotal > 0, 'Server fare must be positive');

      // Attempt to post payment order; client amount is not accepted or queried
      const paymentOrder = await harness.patientClient.createPaymentOrder(booking.id);

      assert.equal(paymentOrder.amount, expectedTotal, 'Payment order amount must exactly match server calculated fare total');
      assert.equal(paymentOrder.currency, 'INR');
      assert.equal(paymentOrder.journeyId, booking.id);
      assert.equal(paymentOrder.patientId, harness.patient.id);
      assert.equal(paymentOrder.status, 'CREATED');
    });

    // ----------------------------------------------------
    // TEST 2: Payment Creation & Reference Test
    // ----------------------------------------------------
    await runTest('2. Payment creation: Correctly linked, initialized to CREATED with valid receipt and order references', async () => {
      const orders = await harness.patientClient.getJourneyPayments(booking.id);
      assert.ok(orders.length >= 1, 'Should find created payment order for journey');
      const order = orders[0];

      assert.equal(order.status, 'CREATED');
      assert.ok(order.receiptNumber.startsWith('REC-2026-'), 'Receipt number must follow standardized non-clinical sequence REC-2026-');
      assert.ok(order.providerOrderId.startsWith('order_sbx_'), 'Provider order ID must be generated by sandbox adapter');
      assert.equal(order.provider, 'MOCK_SANDBOX');
      assert.ok(order.fareSnapshot, 'Order must store immutable snapshot of fare breakdown');
    });

    // ----------------------------------------------------
    // TEST 3: Authorization & RBAC Test
    // ----------------------------------------------------
    await runTest('3. Authorization & RBAC: Patient owns payment, Care Partner can view, IDOR is rejected, Admin has full visibility', async () => {
      const payments = await harness.patientClient.getJourneyPayments(booking.id);
      const paymentId = payments[0].id;

      // 1. Patient who owns the journey can view order
      const fetchedByPatient = await harness.patientClient.getPaymentOrder(paymentId);
      assert.equal(fetchedByPatient.id, paymentId);

      // 2. Unrelated patient attempting to access patient A's payment -> IDOR blocked (403)
      await assert.rejects(
        async () => {
          await harness.otherPatientClient.getPaymentOrder(paymentId);
        },
        (err: any) => {
          assert.equal(err.status, 403, 'Other patient must receive 403 FORBIDDEN on IDOR attempt');
          return true;
        }
      );

      // 3. Other patient attempting to create payment on patient A's journey -> 403
      await assert.rejects(
        async () => {
          await harness.otherPatientClient.createPaymentOrder(booking.id);
        },
        (err: any) => {
          assert.equal(err.status, 403, 'Other patient cannot create payment for someone else');
          return true;
        }
      );

      // 4. Care Partner cannot create payment for journey
      await assert.rejects(
        async () => {
          await harness.partnerClient.createPaymentOrder(booking.id);
        },
        (err: any) => {
          assert.equal(err.status, 403, 'Care partner cannot initiate payment');
          return true;
        }
      );

      // 5. Admin can retrieve all commercial payments
      const adminAll = await harness.adminClient.getAllPaymentsAdmin();
      assert.ok(Array.isArray(adminAll));
      assert.ok(adminAll.some((p) => p.id === paymentId), 'Admin can view all commercial transactions');

      // 6. Non-admin cannot call admin overview
      await assert.rejects(
        async () => {
          await harness.patientClient.getAllPaymentsAdmin();
        },
        (err: any) => {
          assert.equal(err.status, 403, 'Patient cannot access admin payments ledger');
          return true;
        }
      );

      // 7. Unauthenticated request is rejected
      await assert.rejects(
        async () => {
          await harness.unauthenticatedClient.getPaymentOrder(paymentId);
        },
        (err: any) => {
          assert.equal(err.status, 401, 'Unauthenticated request must be rejected with 401');
          return true;
        }
      );
    });

    // ----------------------------------------------------
    // TEST 4: Duplicate / Idempotency Test
    // ----------------------------------------------------
    await runTest('4. Duplicate & Idempotency: IdempotencyKey returns existing order, preventing double charging', async () => {
      // Create another fresh booking
      const freshBooking = await createFreshBooking();

      const uniqueKey = `idemp-test-${Date.now()}-abc`;

      // 1. First order creation with key
      const first = await harness.patientClient.createPaymentOrder(freshBooking.id, uniqueKey);

      // 2. Second order creation with SAME key -> returns identical order
      const second = await harness.patientClient.createPaymentOrder(freshBooking.id, uniqueKey);
      assert.equal(first.id, second.id, 'Idempotent request must return the exact same payment order ID');
      assert.equal(first.receiptNumber, second.receiptNumber);

      // Verify only 1 order exists in store for this key
      const allForBooking = await harness.patientClient.getJourneyPayments(freshBooking.id);
      const withKey = allForBooking.filter((p) => p.idempotencyKey === uniqueKey);
      assert.equal(withKey.length, 1, 'Exactly one payment record must exist in store');
    });

    // ----------------------------------------------------
    // TEST 5: Successful Payment & Invoice Test
    // ----------------------------------------------------
    await runTest('5. Successful payment: Valid HMAC signature verification transitions to SUCCESS and generates official invoice', async () => {
      const freshBooking = await createFreshBooking();

      const order = await harness.patientClient.createPaymentOrder(freshBooking.id);
      assert.equal(order.status, 'CREATED');

      const providerPaymentId = `pay_sbx_valid_${Date.now()}`;
      // Generate authentic HMAC SHA-256 sandbox signature
      const validSignature = SandboxPaymentProvider.generateSandboxSignature(
        order.providerOrderId,
        providerPaymentId
      );

      // Confirm payment with valid cryptographic signature
      const confirmed = await harness.patientClient.confirmPayment(order.id, {
        providerPaymentId,
        providerSignature: validSignature,
      });

      assert.equal(confirmed.status, 'SUCCESS', 'Payment status must transition to SUCCESS upon valid signature');
      assert.equal(confirmed.providerPaymentId, providerPaymentId);
      assert.ok(confirmed.paidAt, 'paidAt must be recorded');

      // Verify invoice generation
      const invoice = await harness.patientClient.getPaymentInvoice(order.id);
      assert.equal(invoice.status, 'SUCCESS');
      assert.equal(invoice.invoiceNumber, `INV-2026-${order.receiptNumber}`);
      assert.equal(invoice.amount, order.amount);
      assert.equal(invoice.currency, 'INR');
      assert.ok(invoice.fareBreakdown, 'Invoice must include fareBreakdown');
      assert.equal(invoice.providerPaymentId, providerPaymentId);

      // Subsequent attempt to create a new order on already paid journey should be rejected
      await assert.rejects(
        async () => {
          await harness.patientClient.createPaymentOrder(freshBooking.id);
        },
        (err: any) => {
          assert.equal(err.status, 409, 'Creating payment for already paid journey must return 409 conflict');
          return true;
        }
      );
    });

    // ----------------------------------------------------
    // TEST 6: Failed Payment Test
    // ----------------------------------------------------
    await runTest('6. Failed payment: Invalid cryptographic signature transitions to FAILED without corrupting journey', async () => {
      const freshBooking = await createFreshBooking();

      const order = await harness.patientClient.createPaymentOrder(freshBooking.id);
      const journeyBefore = await harness.service.getJourneyById(freshBooking.id);

      // Confirm payment with deliberately invalid signature
      await assert.rejects(
        async () => {
          await harness.patientClient.confirmPayment(order.id, {
            providerPaymentId: 'pay_sbx_tampered',
            providerSignature: 'simulated_failure_signature',
          });
        },
        (err: any) => {
          assert.equal(err.status, 400, 'Invalid signature confirmation must be rejected with 400');
          return true;
        }
      );

      // Check payment status is recorded as FAILED
      const orderAfter = await harness.patientClient.getPaymentOrder(order.id);
      assert.equal(orderAfter.status, 'FAILED');
      assert.ok(orderAfter.failureReason, 'failureReason must be recorded');

      // CRITICAL: Verify journey state is NOT corrupted
      const journeyAfter = await harness.service.getJourneyById(freshBooking.id);
      assert.equal(journeyAfter?.currentState, journeyBefore?.currentState, 'Journey state machine must be untouched by payment failure');
    });

    // ----------------------------------------------------
    // TEST 7: Webhook & Signature Validation Test
    // ----------------------------------------------------
    await runTest('7. Webhooks: Valid HMAC signature processes capture/failure; invalid signature is rejected', async () => {
      const freshBooking = await createFreshBooking();

      const order = await harness.patientClient.createPaymentOrder(freshBooking.id);

      // 1. Send webhook with INVALID signature -> Expect 400
      const invalidWebhookPayload = JSON.stringify({
        event: 'payment.captured',
        payload: {
          payment: {
            entity: {
              id: 'pay_hook_123',
              order_id: order.providerOrderId,
            },
          },
        },
      });

      const badRes = await fetch(`${harness.baseUrl}/api/payments/webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-razorpay-signature': 'bad_tampered_signature_hex',
        },
        body: invalidWebhookPayload,
      });
      assert.equal(badRes.status, 400, 'Tampered webhook signature must return 400 Bad Request');

      // 2. Send webhook with VALID HMAC signature
      const validPayload = JSON.stringify({
        event: 'payment.captured',
        payload: {
          payment: {
            entity: {
              id: 'pay_hook_valid_456',
              order_id: order.providerOrderId,
            },
          },
        },
      });
      const validWebhookSig = SandboxPaymentProvider.generateSandboxWebhookSignature(validPayload);

      const goodRes = await fetch(`${harness.baseUrl}/api/payments/webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-razorpay-signature': validWebhookSig,
        },
        body: validPayload,
      });
      assert.equal(goodRes.status, 200, 'Valid webhook signature must return 200 OK');
      const hookResult = await goodRes.json();
      assert.equal(hookResult.success, true);
      assert.equal(hookResult.handled, true);

      // Verify payment order updated to SUCCESS
      const orderAfterHook = await harness.patientClient.getPaymentOrder(order.id);
      assert.equal(orderAfterHook.status, 'SUCCESS');
      assert.equal(orderAfterHook.providerPaymentId, 'pay_hook_valid_456');
    });

    // ----------------------------------------------------
    // TEST 8: Payment & Journey Isolation Test
    // ----------------------------------------------------
    await runTest('8. Payment / Journey Isolation: Payment SUCCESS does NOT mark journey COMPLETED', async () => {
      const freshBooking = await createFreshBooking();

      assert.equal(freshBooking.currentState, 'MATCHING');

      // Pay before journey even matches
      const order = await harness.patientClient.createPaymentOrder(freshBooking.id);
      await harness.patientClient.confirmPayment(order.id, {
        providerPaymentId: `pay_sbx_iso_${Date.now()}`,
        providerSignature: `test_valid_sig_${order.providerOrderId}`,
      });

      // Confirm payment status
      const paidOrder = await harness.patientClient.getPaymentOrder(order.id);
      assert.equal(paidOrder.status, 'SUCCESS');

      // CRITICAL CHECK: Journey MUST remain in MATCHING (NOT COMPLETED!)
      const journey = await harness.service.getJourneyById(freshBooking.id);
      assert.equal(
        journey?.currentState,
        'MATCHING',
        'Successful payment must NOT mark journey COMPLETED. Journey progresses solely via transportation milestones.'
      );
    });

    // ----------------------------------------------------
    // TEST 9: Audit Logging & Sensitive Data Redaction Test
    // ----------------------------------------------------
    await runTest('9. Audit logging & Privacy: Audit records created without storing prohibited credentials', async () => {
      const logs = await harness.store.auditLogs.findAll();

      // Check for payment actions in audit logs
      const paymentLogs = logs.filter((l: any) => l.entityType === 'payment');
      assert.ok(paymentLogs.length > 0, 'Audit logs must capture payment operations');

      const actionsLogged = paymentLogs.map((l: any) => l.action);
      assert.ok(actionsLogged.includes('PAYMENT_ORDER_CREATED'), 'Must log PAYMENT_ORDER_CREATED');
      assert.ok(actionsLogged.includes('PAYMENT_SUCCESS'), 'Must log PAYMENT_SUCCESS');

      // Verify privacy / credentials:
      for (const log of paymentLogs) {
        const str = JSON.stringify(log);
        assert.equal(str.includes('cvv'), false, 'CVV must never be logged or stored');
        assert.equal(str.includes('upi_pin'), false, 'UPI PIN must never be logged or stored');
        assert.equal(str.includes('cardNumber'), false, 'Card numbers must never be logged or stored');
      }
    });

    // ----------------------------------------------------
    // TEST 10: Provider Config & Environment Isolation Test
    // ----------------------------------------------------
    await runTest('10. Provider Config: Public config returns safe metadata and never leaks server secrets', async () => {
      const config = await harness.patientClient.getPaymentConfig();
      assert.ok(config);
      assert.equal(config.provider, 'MOCK_SANDBOX');
      assert.equal(config.isProduction, false);
      assert.equal(config.isConfigured, false);

      // Verify no secrets exposed in public config
      const configStr = JSON.stringify(config);
      assert.equal(configStr.includes('keySecret'), false, 'keySecret must not be in public config');
      assert.equal(configStr.includes('webhookSecret'), false, 'webhookSecret must not be in public config');

      // Verify Razorpay provider adapter initializes safely with empty env
      const rzp = new RazorpayPaymentProvider();
      assert.equal(rzp.isConfigured, false, 'Razorpay provider without env credentials must report isConfigured = false');
      assert.equal(rzp.isProduction, false);
      const rzpConfig = rzp.getPublicConfig();
      assert.equal(rzpConfig.isConfigured, false);
    });

    console.log('\n------------------------------------------------------');
    console.log(`TOTAL COMMERCIAL PAYMENT TESTS: ${testCount} | PASSED: ${passCount} | FAILED: 0`);
    console.log('ALL COMMERCIAL PAYMENT GATEWAY TESTS PASSED!');
    console.log('------------------------------------------------------\n');
  } finally {
    await harness.cleanup();
  }
}

runAllPaymentTests().catch((err) => {
  console.error('[TEST SUITE FATAL ERROR]', err);
  process.exit(1);
});
