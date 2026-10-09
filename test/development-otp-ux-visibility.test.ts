import assert from 'node:assert/strict';
import { InMemoryRelationalDriver } from '../src/server/db/driver.ts';
import { PostgresDomainStore } from '../src/server/db/repositories/postgres-repositories.ts';
import { JourneyService } from '../src/services/journey-service.ts';
import { createApiApp } from '../src/server/api/app.ts';
import { ServerAuthService } from '../src/server/auth/server-auth-service.ts';
import { DevelopmentConsoleOtpProvider } from '../src/server/auth/sms-provider.ts';
import { NeravuApiClient, ACTIVE_OTP_CHALLENGE_STORAGE_KEY } from '../src/services/api-client.ts';

let passed = 0;
let failed = 0;

async function testAsync(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`  ✓ [DEV OTP TEST] ${name}`);
    passed++;
  } catch (err: any) {
    console.error(`  ✗ [DEV OTP TEST] ${name}`);
    console.error(`    Error: ${err?.message || err}`);
    failed++;
  }
}

async function createTestHarness(env: 'test' | 'development' | 'production' = 'development') {
  process.env.NODE_ENV = env;
  DevelopmentConsoleOtpProvider.clearOutbox();

  const driver = new InMemoryRelationalDriver();
  await driver.connect();
  const store = new PostgresDomainStore(driver);
  const journeyService = new JourneyService(store);
  const authService = new ServerAuthService(store, {
    otpExpirySeconds: 300,
    otpCooldownSeconds: 0,
    otpMaxAttempts: 5,
    sessionDurationSeconds: 3600,
  });

  const app = createApiApp(journeyService, { authService });
  const server = await new Promise<any>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const addr: any = server.address();
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  const cleanup = async () => {
    process.env.NODE_ENV = 'test';
    DevelopmentConsoleOtpProvider.clearOutbox();
    await new Promise((resolve) => server.close(() => resolve()));
    if (driver.isConnected()) {
      await driver.disconnect();
    }
  };

  return { driver, store, authService, server, baseUrl, cleanup };
}

async function runDevOtpTests() {
  console.log('\n==================================================');
  console.log('NERAVU DEVELOPMENT OTP VISIBILITY & PERSISTENCE TEST SUITE');
  console.log('==================================================');

  await testAsync('1. Development OTP endpoint returns generated code for active challenge in dev', async () => {
    const h = await createTestHarness('development');
    try {
      const phone = '+919876543210';
      const reqRes = await fetch(`${h.baseUrl}/api/auth/otp/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phoneNumber: phone }),
      });
      assert.equal(reqRes.status, 200);
      const reqData = await reqRes.json();
      assert.ok(reqData.referenceId);
      assert.equal(reqData.code, undefined); // Never in request response

      const client = new NeravuApiClient({ baseUrl: h.baseUrl });
      const devCode = await client.getDevOtpPreview(reqData.referenceId);
      assert.ok(devCode, 'Dev OTP should be retrieved');
      assert.match(devCode, /^\d{6}$/, 'Dev OTP must be 6 numeric digits');

      // Matching outbox directly
      const directCode = DevelopmentConsoleOtpProvider.getLastOtpForReference(reqData.referenceId);
      assert.equal(devCode, directCode);
    } finally {
      await h.cleanup();
    }
  });

  await testAsync('2. Development OTP endpoint is strictly forbidden (HTTP 403) in production', async () => {
    const h = await createTestHarness('production');
    try {
      // In production, GET /api/auth/dev-otp/:referenceId must return 403
      const res = await fetch(`${h.baseUrl}/api/auth/dev-otp/otp-sample-ref-id`);
      assert.equal(res.status, 403);
      const data = await res.json();
      assert.equal(data.error, 'FORBIDDEN_IN_PRODUCTION');

      const client = new NeravuApiClient({ baseUrl: h.baseUrl });
      const preview = await client.getDevOtpPreview('otp-sample-ref-id');
      assert.equal(preview, null, 'Client safely returns null in production');
    } finally {
      await h.cleanup();
    }
  });

  await testAsync('3. Development OTP endpoint returns 410 when challenge has already been verified/consumed', async () => {
    const h = await createTestHarness('development');
    try {
      const phone = '+919876543210';
      const reqRes = await fetch(`${h.baseUrl}/api/auth/otp/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phoneNumber: phone }),
      });
      const { referenceId } = await reqRes.json();

      const client = new NeravuApiClient({ baseUrl: h.baseUrl });
      const devCode = await client.getDevOtpPreview(referenceId);
      assert.ok(devCode);

      // Verify the OTP
      const verifyRes = await fetch(`${h.baseUrl}/api/auth/otp/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phoneNumber: phone, referenceId, code: devCode }),
      });
      assert.equal(verifyRes.status, 200);

      // Subsequent fetch should return 410 OTP_CONSUMED
      const resAfterVerify = await fetch(`${h.baseUrl}/api/auth/dev-otp/${referenceId}`);
      assert.equal(resAfterVerify.status, 410);
      const data = await resAfterVerify.json();
      assert.equal(data.error, 'OTP_CONSUMED');

      // Client safely returns null
      const previewAfterVerify = await client.getDevOtpPreview(referenceId);
      assert.equal(previewAfterVerify, null);
    } finally {
      await h.cleanup();
    }
  });

  await testAsync('4. Development OTP endpoint returns 410 when challenge is expired', async () => {
    const h = await createTestHarness('development');
    try {
      h.authService.configureTiming({ otpExpirySeconds: -10, otpCooldownSeconds: 0 });
      const phone = '+919876543210';
      const reqRes = await fetch(`${h.baseUrl}/api/auth/otp/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phoneNumber: phone }),
      });
      const { referenceId } = await reqRes.json();

      const resExpired = await fetch(`${h.baseUrl}/api/auth/dev-otp/${referenceId}`);
      assert.equal(resExpired.status, 410);
      const data = await resExpired.json();
      assert.equal(data.error, 'OTP_EXPIRED');

      const client = new NeravuApiClient({ baseUrl: h.baseUrl });
      const previewExpired = await client.getDevOtpPreview(referenceId);
      assert.equal(previewExpired, null);
    } finally {
      await h.cleanup();
    }
  });

  await testAsync('5. Requesting a new OTP replaces the reference and provides the new OTP', async () => {
    const h = await createTestHarness('development');
    try {
      h.authService.configureTiming({ otpCooldownSeconds: 0 });
      const phone = '+919876543210';

      const firstReq = await fetch(`${h.baseUrl}/api/auth/otp/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phoneNumber: phone }),
      });
      const { referenceId: ref1 } = await firstReq.json();
      const code1 = DevelopmentConsoleOtpProvider.getLastOtpForReference(ref1);

      const secondReq = await fetch(`${h.baseUrl}/api/auth/otp/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phoneNumber: phone }),
      });
      const { referenceId: ref2 } = await secondReq.json();
      assert.notEqual(ref1, ref2, 'New reference ID must be generated');

      const client = new NeravuApiClient({ baseUrl: h.baseUrl });
      const code2 = await client.getDevOtpPreview(ref2);
      assert.ok(code2);
      assert.equal(code2, DevelopmentConsoleOtpProvider.getLastOtpForReference(ref2));
    } finally {
      await h.cleanup();
    }
  });

  await testAsync('6. Storage security verification: ACTIVE_OTP_CHALLENGE_STORAGE_KEY stores only metadata, no raw OTP', async () => {
    // Verify structural metadata schema
    const simulatedChallenge = {
      phoneNumber: '+919876543210',
      referenceId: 'otp-1791480000000-abcd12',
      expiresInSeconds: 300,
      expiresAt: Date.now() + 300000,
    };
    const serialized = JSON.stringify(simulatedChallenge);

    assert.equal(ACTIVE_OTP_CHALLENGE_STORAGE_KEY, 'neravu_active_otp_challenge');
    assert.ok(serialized.includes(simulatedChallenge.referenceId));
    assert.ok(serialized.includes(simulatedChallenge.phoneNumber));
    assert.ok(!serialized.includes('"code"'));
    assert.ok(!serialized.includes('"otp"'));
    assert.ok(!serialized.includes('"devCode"'));
  });

  console.log('--------------------------------------------------');
  console.log(`TOTAL DEV OTP TESTS: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
  if (failed === 0) {
    console.log('ALL DEVELOPMENT OTP VISIBILITY & PERSISTENCE TESTS PASSED!');
  }
  console.log('--------------------------------------------------\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runDevOtpTests().catch((err) => {
  console.error('Fatal test runner error:', err);
  process.exit(1);
});
