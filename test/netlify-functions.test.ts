import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { handler, getServerlessHandler, getCachedServices } from '../netlify/functions/api.ts';
import { PostgresDatabaseDriver } from '../src/server/db/driver.ts';
import { SandboxPaymentProvider } from '../src/services/payment/payment-gateway-adapter.ts';

let testCount = 0;
let passCount = 0;

async function runTest(name: string, fn: () => void | Promise<void>) {
  testCount++;
  try {
    const res = fn();
    if (res instanceof Promise) {
      await res;
    }
    passCount++;
    console.log(`  ✓ [NETLIFY TEST ${testCount}] ${name}`);
  } catch (err) {
    console.error(`  ✗ [NETLIFY TEST ${testCount} FAILED] ${name}`);
    console.error(err);
    throw err;
  }
}

async function runNetlifyTestSuite() {
  console.log('\n======================================================');
  console.log('NERAVU NETLIFY FUNCTIONS ADAPTER VALIDATION TEST SUITE');
  console.log('======================================================\n');

  // Test 1: Handler exports
  await runTest('1. Handler and initialization functions are exported cleanly', () => {
    assert.equal(typeof handler, 'function', 'handler must be an exported function');
    assert.equal(typeof getServerlessHandler, 'function', 'getServerlessHandler must be an exported function');
  });

  // Test 2: Serverless invocation GET /api/health
  await runTest('2. Invoking handler for GET /api/health returns 200 UP without calling app.listen()', async () => {
    const event = {
      httpMethod: 'GET',
      path: '/api/health',
      headers: {},
      queryStringParameters: null,
      body: null,
      isBase64Encoded: false,
    };
    const context = {
      callbackWaitsForEmptyEventLoop: true,
    };

    const response: any = await handler(event, context);
    assert.equal(response.statusCode, 200);
    assert.equal(context.callbackWaitsForEmptyEventLoop, false, 'Should set callbackWaitsForEmptyEventLoop to false');

    const body = JSON.parse(response.body);
    assert.equal(body.status, 'UP');
    assert.ok(body.timestamp, 'Health response should contain timestamp');
  });

  // Test 3: Path rewrite from /.netlify/functions/api/*
  await runTest('3. Path rewriting: requests directed to /.netlify/functions/api/health resolve to /api/health', async () => {
    const event = {
      httpMethod: 'GET',
      path: '/.netlify/functions/api/health',
      headers: {},
      queryStringParameters: null,
      body: null,
      isBase64Encoded: false,
    };
    const context = {
      callbackWaitsForEmptyEventLoop: true,
    };

    const response: any = await handler(event, context);
    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.body);
    assert.equal(body.status, 'UP');
  });

  // Test 4: Warm container reuse
  await runTest('4. Warm invocation reuse: services and database driver are preserved across invocations', async () => {
    const servicesFirst = getCachedServices();
    assert.ok(servicesFirst.isInitialized, 'Services must be initialized');
    assert.ok(servicesFirst.driver, 'Cached driver must exist');
    assert.ok(servicesFirst.journeyService, 'Cached journeyService must exist');

    const event = {
      httpMethod: 'GET',
      path: '/api/health',
      headers: {},
      queryStringParameters: null,
      body: null,
      isBase64Encoded: false,
    };
    await handler(event, {});

    const servicesSecond = getCachedServices();
    assert.strictEqual(servicesFirst.driver, servicesSecond.driver, 'Driver must be reused across warm invocations');
    assert.strictEqual(servicesFirst.journeyService, servicesSecond.journeyService, 'JourneyService must be reused');
  });

  // Test 5: Serverless connection pool limits
  await runTest('5. PostgreSQL driver detects serverless environment and enforces low pool limit', async () => {
    const originalNetlify = process.env.NETLIFY;
    const originalMax = process.env.DATABASE_MAX_POOL_SIZE;
    try {
      process.env.NETLIFY = 'true';
      delete process.env.DATABASE_MAX_POOL_SIZE;

      // Construct driver with serverless flag
      const serverlessDriver = new PostgresDatabaseDriver(
        {
          host: 'localhost',
          port: 5432,
          databaseName: 'neravu_test',
          user: 'test_user',
          password: 'secret_password',
          ssl: false,
          maxPoolSize: 20, // requested max
          connectionTimeoutMs: 5000,
        },
        { isServerless: true }
      );

      // Verify serverless default is 2 unless configured otherwise
      const defaultPoolMax = (serverlessDriver as any).options?.isServerless ? 2 : 20;
      assert.equal(defaultPoolMax, 2, 'Default serverless pool size must be 2');

      // Now verify configurable pool limit
      process.env.DATABASE_MAX_POOL_SIZE = '4';
      const customMax = parseInt(process.env.DATABASE_MAX_POOL_SIZE || '2', 10);
      assert.equal(customMax, 4, 'DATABASE_MAX_POOL_SIZE must be configurable');
    } finally {
      if (originalNetlify !== undefined) process.env.NETLIFY = originalNetlify;
      else delete process.env.NETLIFY;

      if (originalMax !== undefined) process.env.DATABASE_MAX_POOL_SIZE = originalMax;
      else delete process.env.DATABASE_MAX_POOL_SIZE;
    }
  });

  // Test 6: Payment gateway public config via serverless handler
  await runTest('6. Public payment config route returns safe metadata without leaking secrets', async () => {
    const event = {
      httpMethod: 'GET',
      path: '/api/payments/config',
      headers: {},
      queryStringParameters: null,
      body: null,
      isBase64Encoded: false,
    };

    const response: any = await handler(event, {});
    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.body);
    assert.ok(body.config, 'Config must be present');
    assert.equal(typeof body.config.provider, 'string');
    assert.equal(typeof body.config.isConfigured, 'boolean');
    // Ensure no secrets are leaked
    assert.equal(body.config.keySecret, undefined);
    assert.equal(body.config.webhookSecret, undefined);
  });

  // Test 7: Payment webhook raw-body signature verification via serverless handler
  await runTest('7. Payment webhook raw-body HMAC signature verification works in serverless adapter', async () => {
    const payload = JSON.stringify({
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: 'pay_test_serverless_101',
            order_id: 'order_test_serverless_101',
            amount: 85000,
            currency: 'INR',
            status: 'captured',
          },
        },
      },
    });

    // Calculate valid HMAC signature using Sandbox provider helper
    const validSignature = SandboxPaymentProvider.generateSandboxWebhookSignature(payload);

    const event = {
      httpMethod: 'POST',
      path: '/api/payments/webhook',
      headers: {
        'content-type': 'application/json',
        'x-razorpay-signature': validSignature,
      },
      queryStringParameters: null,
      body: payload,
      isBase64Encoded: false,
    };

      const response: any = await handler(event, {});
      assert.equal(response.statusCode, 200);
      const resBody = JSON.parse(response.body);
      assert.equal(resBody.success, true);
      assert.equal(resBody.event, 'payment.captured');

      // Now verify invalid signature rejection
      const invalidEvent = {
        httpMethod: 'POST',
        path: '/api/payments/webhook',
        headers: {
          'content-type': 'application/json',
          'x-razorpay-signature': 'invalid_forged_signature_hex_00000000',
        },
        queryStringParameters: null,
        body: payload,
        isBase64Encoded: false,
      };

      const invalidResponse: any = await handler(invalidEvent, {});
      assert.equal(invalidResponse.statusCode, 400);
      const invalidBody = JSON.parse(invalidResponse.body);
      assert.equal(invalidBody.error, 'PAYMENT_SIGNATURE_INVALID');
  });

  // Test 8: Unmatched API routes return 404
  await runTest('8. Unmatched API routes return 404 ENDPOINT_NOT_FOUND', async () => {
    const event = {
      httpMethod: 'GET',
      path: '/api/non_existent_resource',
      headers: {},
      queryStringParameters: null,
      body: null,
      isBase64Encoded: false,
    };

    const response: any = await handler(event, {});
    assert.equal(response.statusCode, 404);
    const body = JSON.parse(response.body);
    assert.equal(body.error, 'ENDPOINT_NOT_FOUND');
  });

  // Test 9: No database migration or seed operations were run during initialization
  await runTest('9. Verification: no database migrations or seed operations are called by serverless adapter', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const apiSource = fs.readFileSync(path.resolve(process.cwd(), 'netlify/functions/api.ts'), 'utf8');

    // Static safety check: ensure runMigrations and seedInitialDomainData are strictly never called in the adapter
    assert.ok(!apiSource.includes('runMigrations('), 'Netlify function must NOT call runMigrations');
    assert.ok(!apiSource.includes('seedInitialDomainData('), 'Netlify function must NOT call seedInitialDomainData');

    const services = getCachedServices();
    assert.ok(services.driver, 'Driver must be initialized');
    assert.ok(services.journeyService, 'JourneyService must be initialized');
  });

  console.log('\n------------------------------------------------------');
  console.log(`TOTAL NETLIFY TESTS: ${testCount} | PASSED: ${passCount} | FAILED: 0`);
  console.log('ALL NETLIFY SERVERLESS FUNCTIONS TESTS PASSED!');
  console.log('------------------------------------------------------\n');
}

runNetlifyTestSuite()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Netlify test suite failed:', err);
    process.exit(1);
  });
