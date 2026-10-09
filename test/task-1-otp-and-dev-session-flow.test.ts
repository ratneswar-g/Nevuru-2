import assert from 'node:assert/strict';
import { InMemoryRelationalDriver } from '../src/server/db/driver.ts';
import { PostgresDomainStore } from '../src/server/db/repositories/postgres-repositories.ts';
import { JourneyService } from '../src/services/journey-service.ts';
import { createApiApp } from '../src/server/api/app.ts';
import { ServerAuthService } from '../src/server/auth/server-auth-service.ts';
import { DevelopmentConsoleOtpProvider } from '../src/server/auth/sms-provider.ts';
import { NeravuApiClient } from '../src/services/api-client.ts';
import { DevelopmentAuthProvider } from '../src/auth/development-auth.ts';

let passed = 0;
let failed = 0;

async function testAsync(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`  ✓ [TASK 1 TEST] ${name}`);
    passed++;
  } catch (err: any) {
    console.error(`  ✗ [TASK 1 TEST] ${name}`);
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

async function runTask1TestSuite() {
  console.log('\n==================================================');
  console.log('NERAVU TASK 1: REAL PHONE OTP FLOW & DEV SESSION REMEDIATION TESTS');
  console.log('==================================================');

  await testAsync('1. DevelopmentAuthProvider does NOT automatically restore dev persona on fresh startup', async () => {
    const devProvider = new DevelopmentAuthProvider();
    const sessionOnStartup = await devProvider.getCurrentSession();
    assert.equal(sessionOnStartup, null, 'Normal startup must return null session, not auto-logged into demo user');
    const userOnStartup = await devProvider.getCurrentUser();
    assert.equal(userOnStartup, null, 'Normal startup user must be null');
  });

  await testAsync('2. Explicit developer role login creates an in-memory session', async () => {
    const devProvider = new DevelopmentAuthProvider();
    const session = await devProvider.loginAsDevRole('PATIENT');
    assert.ok(session);
    assert.equal(session.user.role, 'PATIENT');
    assert.equal(session.isDevelopmentSession, true);

    const current = await devProvider.getCurrentSession();
    assert.equal(current?.user.id, session.user.id);

    await devProvider.logout();
    const afterLogout = await devProvider.getCurrentSession();
    assert.equal(afterLogout, null);
  });

  await testAsync('3. Real phone OTP request generates challenge and referenceId without exposing code in request body', async () => {
    const h = await createTestHarness('development');
    try {
      const phone = '+919876543210';
      const client = new NeravuApiClient({ baseUrl: h.baseUrl });
      const reqRes = await client.requestOtp(phone);

      assert.ok(reqRes.referenceId, 'referenceId must be present');
      assert.equal((reqRes as any).code, undefined, 'Raw code must not be exposed in request response');

      // Dev OTP endpoint provides the single authoritative code in dev
      const devCode = await client.getDevOtpPreview(reqRes.referenceId);
      assert.ok(devCode);
      assert.match(devCode, /^\d{6}$/);

      // Verify OTP works with retrieved code
      const verifyRes = await client.verifyOtp({
        phoneNumber: phone,
        referenceId: reqRes.referenceId,
        code: devCode,
      });

      assert.equal(verifyRes.success, true);
      assert.equal(verifyRes.requiresRegistration, true, 'Unregistered phone number must require registration');
    } finally {
      await h.cleanup();
    }
  });

  await testAsync('4. Production environment strictly forbids dev-otp inspection (HTTP 403)', async () => {
    const h = await createTestHarness('production');
    try {
      const client = new NeravuApiClient({ baseUrl: h.baseUrl });
      const preview = await client.getDevOtpPreview('any-ref-id');
      assert.equal(preview, null, 'Client returns null in production');

      const res = await fetch(`${h.baseUrl}/api/auth/dev-otp/any-ref-id`);
      assert.equal(res.status, 403);
    } finally {
      await h.cleanup();
    }
  });

  await testAsync('5. Development role switching remains forbidden in production', async () => {
    const h = await createTestHarness('production');
    try {
      const client = new NeravuApiClient({ baseUrl: h.baseUrl });
      await assert.rejects(async () => {
        await client.devLogin('PATIENT');
      });
    } finally {
      await h.cleanup();
    }
  });

  console.log('--------------------------------------------------');
  console.log(`TOTAL TASK 1 TESTS: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
  if (failed === 0) {
    console.log('ALL TASK 1 TESTS PASSED!');
  }
  console.log('--------------------------------------------------\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTask1TestSuite().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
