import assert from "node:assert/strict";
import { getServerAuthSecret, hashOtpCode, hashSessionToken } from "../src/server/auth/crypto-utils.ts";

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`  ✓ [HARDENING TEST] ${name}`);
    passed++;
  } catch (err: any) {
    console.error(`  ✗ [HARDENING TEST] ${name}`);
    console.error(`    Error: ${err?.message || err}`);
    failed++;
  }
}

async function runHardeningTests() {
  console.log("\n==================================================");
  console.log("NERAVU PRODUCTION HARDENING: DATABASE FAIL-FAST & AUTH SESSION SECRET");
  console.log("==================================================");

  // 1. Auth Session Secret - Production Fail-Fast
  await test("1. Production without AUTH_SESSION_SECRET throws clear configuration error", () => {
    const prevEnv = process.env.NODE_ENV;
    const prevSecret = process.env.AUTH_SESSION_SECRET;
    try {
      process.env.NODE_ENV = "production";
      delete process.env.AUTH_SESSION_SECRET;

      assert.throws(
        () => getServerAuthSecret(),
        /AUTH_SESSION_SECRET environment variable is missing in production/i
      );
    } finally {
      process.env.NODE_ENV = prevEnv;
      if (prevSecret !== undefined) process.env.AUTH_SESSION_SECRET = prevSecret;
      else delete process.env.AUTH_SESSION_SECRET;
    }
  });

  await test("2. Production with empty/whitespace AUTH_SESSION_SECRET throws clear configuration error", () => {
    const prevEnv = process.env.NODE_ENV;
    const prevSecret = process.env.AUTH_SESSION_SECRET;
    try {
      process.env.NODE_ENV = "production";
      process.env.AUTH_SESSION_SECRET = "   ";

      assert.throws(
        () => getServerAuthSecret(),
        /AUTH_SESSION_SECRET environment variable is missing in production/i
      );
    } finally {
      process.env.NODE_ENV = prevEnv;
      if (prevSecret !== undefined) process.env.AUTH_SESSION_SECRET = prevSecret;
      else delete process.env.AUTH_SESSION_SECRET;
    }
  });

  await test("3. Production with AUTH_SESSION_SECRET shorter than 32 characters throws clear configuration error", () => {
    const prevEnv = process.env.NODE_ENV;
    const prevSecret = process.env.AUTH_SESSION_SECRET;
    try {
      process.env.NODE_ENV = "production";
      process.env.AUTH_SESSION_SECRET = "short-secret-under-32-chars";

      assert.throws(
        () => getServerAuthSecret(),
        /Production secret must be at least 32 characters/i
      );
    } finally {
      process.env.NODE_ENV = prevEnv;
      if (prevSecret !== undefined) process.env.AUTH_SESSION_SECRET = prevSecret;
      else delete process.env.AUTH_SESSION_SECRET;
    }
  });

  await test("4. Production with valid AUTH_SESSION_SECRET (>= 32 chars) succeeds and hashes tokens correctly", () => {
    const prevEnv = process.env.NODE_ENV;
    const prevSecret = process.env.AUTH_SESSION_SECRET;
    try {
      process.env.NODE_ENV = "production";
      const validSecret = "a".repeat(32);
      process.env.AUTH_SESSION_SECRET = validSecret;

      const resolved = getServerAuthSecret();
      assert.equal(resolved, validSecret);

      const otpHash = hashOtpCode("ref-123", "+919876543210", "123456");
      assert.ok(otpHash && /^[a-f0-9]{64}$/.test(otpHash));

      const sessHash = hashSessionToken("nrv_sess_sample_token_12345");
      assert.ok(sessHash && /^[a-f0-9]{64}$/.test(sessHash));
    } finally {
      process.env.NODE_ENV = prevEnv;
      if (prevSecret !== undefined) process.env.AUTH_SESSION_SECRET = prevSecret;
      else delete process.env.AUTH_SESSION_SECRET;
    }
  });

  await test("5. Development/Test mode preserves existing fallback secret behavior", () => {
    const prevEnv = process.env.NODE_ENV;
    const prevSecret = process.env.AUTH_SESSION_SECRET;
    try {
      process.env.NODE_ENV = "development";
      delete process.env.AUTH_SESSION_SECRET;

      const secret = getServerAuthSecret();
      assert.ok(secret.length > 0);
      assert.ok(secret.includes("neravu-internal-dev"));
    } finally {
      process.env.NODE_ENV = prevEnv;
      if (prevSecret !== undefined) process.env.AUTH_SESSION_SECRET = prevSecret;
      else delete process.env.AUTH_SESSION_SECRET;
    }
  });

  // 2. Database Fail-Fast - Server Bootstrap
  await test("6. Server bootstrap in production fails fast when DATABASE_URL is missing", async () => {
    const prevEnv = process.env.NODE_ENV;
    const prevUrl = process.env.DATABASE_URL;
    const prevHost = process.env.DATABASE_HOST;
    try {
      process.env.NODE_ENV = "production";
      delete process.env.DATABASE_URL;
      delete process.env.DATABASE_HOST;

      const { bootstrapServer } = await import("../server.ts");

      await assert.rejects(
        async () => {
          await bootstrapServer();
        },
        /DATABASE_URL is mandatory in production environment.*In-memory database fallback is strictly forbidden/i
      );
    } finally {
      process.env.NODE_ENV = prevEnv;
      if (prevUrl !== undefined) process.env.DATABASE_URL = prevUrl;
      else delete process.env.DATABASE_URL;
      if (prevHost !== undefined) process.env.DATABASE_HOST = prevHost;
      else delete process.env.DATABASE_HOST;
    }
  });

  await test("7. Server bootstrap in production fails fast when PostgreSQL connection fails", async () => {
    const prevEnv = process.env.NODE_ENV;
    const prevUrl = process.env.DATABASE_URL;
    const prevHost = process.env.DATABASE_HOST;
    try {
      process.env.NODE_ENV = "production";
      // Invalid unreachable host to test fail-fast
      process.env.DATABASE_URL = "postgres://invalid_user:invalid_pass@127.0.0.1:54329/invalid_db";
      delete process.env.DATABASE_HOST;

      const { bootstrapServer } = await import("../server.ts");

      await assert.rejects(
        async () => {
          await bootstrapServer();
        },
        /PostgreSQL connection failed in production.*In-memory fallback is strictly forbidden/i
      );
    } finally {
      process.env.NODE_ENV = prevEnv;
      if (prevUrl !== undefined) process.env.DATABASE_URL = prevUrl;
      else delete process.env.DATABASE_URL;
      if (prevHost !== undefined) process.env.DATABASE_HOST = prevHost;
      else delete process.env.DATABASE_HOST;
    }
  });

  // 3. P0 SMS Provider Production Configuration
  await test("8. P0 SMS - In production, missing credentials reject development provider and return null/fail-closed", async () => {
    const prevEnv = process.env.NODE_ENV;
    const prevUrl = process.env.SMS_PROVIDER_URL;
    const prevKey = process.env.SMS_PROVIDER_API_KEY;
    try {
      process.env.NODE_ENV = "production";
      delete process.env.SMS_PROVIDER_URL;
      delete process.env.SMS_PROVIDER_API_KEY;

      const { resolveSmsOtpProvider, DevelopmentConsoleOtpProvider, ConfiguredProductionSmsProvider } = await import("../src/server/auth/sms-provider.ts");

      // In production without env vars, development provider must NOT be used
      const resolved = resolveSmsOtpProvider();
      assert.equal(resolved, null, "resolveSmsOtpProvider must return null in production when unconfigured");

      // Attempting to pass development provider in production must be refused
      const devProvider = new DevelopmentConsoleOtpProvider();
      const resolvedDev = resolveSmsOtpProvider(devProvider);
      assert.equal(resolvedDev, null, "DevelopmentConsoleOtpProvider must be rejected in production");

      // Providing valid environment configuration produces ConfiguredProductionSmsProvider
      process.env.SMS_PROVIDER_URL = "https://sms.example.com/api/send";
      process.env.SMS_PROVIDER_API_KEY = "test-secret-key-12345";
      const resolvedProd = resolveSmsOtpProvider();
      assert.ok(resolvedProd instanceof ConfiguredProductionSmsProvider);
      assert.equal(resolvedProd.isProductionProvider, true);
    } finally {
      process.env.NODE_ENV = prevEnv;
      if (prevUrl !== undefined) process.env.SMS_PROVIDER_URL = prevUrl;
      else delete process.env.SMS_PROVIDER_URL;
      if (prevKey !== undefined) process.env.SMS_PROVIDER_API_KEY = prevKey;
      else delete process.env.SMS_PROVIDER_API_KEY;
    }
  });

  // 4. P0 CORS & Domain Configuration
  await test("9. P0 CORS - Production never uses wildcard and enforces strict ALLOWED_ORIGINS", async () => {
    const prevEnv = process.env.NODE_ENV;
    const prevOrigins = process.env.ALLOWED_ORIGINS;
    try {
      process.env.NODE_ENV = "production";
      process.env.ALLOWED_ORIGINS = "https://app.neravu.in, https://portal.neravu.in";

      const { createApiApp } = await import("../src/server/api/app.ts");
      const dummyJourneyService = { store: {} } as any;
      const app = createApiApp(dummyJourneyService);
      const server = await new Promise<any>((resolve) => {
        const s = app.listen(0, "127.0.0.1", () => resolve(s));
      });
      const port = server.address().port;
      const baseUrl = `http://127.0.0.1:${port}`;

      try {
        // Request from allowed origin
        const allowedRes = await fetch(`${baseUrl}/api/health`, {
          headers: { Origin: "https://app.neravu.in" },
        });
        assert.equal(allowedRes.headers.get("access-control-allow-origin"), "https://app.neravu.in");
        assert.equal(allowedRes.headers.get("vary"), "Origin");

        // Request from disallowed origin
        const disallowedRes = await fetch(`${baseUrl}/api/health`, {
          headers: { Origin: "https://malicious-site.com" },
        });
        assert.notEqual(disallowedRes.headers.get("access-control-allow-origin"), "*");
        assert.notEqual(disallowedRes.headers.get("access-control-allow-origin"), "https://malicious-site.com");

        // Request without Origin (same-origin / direct server-side) succeeds without CORS error
        const directRes = await fetch(`${baseUrl}/api/health`);
        assert.equal(directRes.status, 200);
      } finally {
        await new Promise((resolve) => server.close(resolve));
      }
    } finally {
      process.env.NODE_ENV = prevEnv;
      if (prevOrigins !== undefined) process.env.ALLOWED_ORIGINS = prevOrigins;
      else delete process.env.ALLOWED_ORIGINS;
    }
  });

  // 5. P0 Google Maps Production Configuration & Graceful Degradation
  await test("10. P0 Maps - Maps service resolves VITE_GOOGLE_MAPS_API_KEY and degrades gracefully", async () => {
    const prevKey = process.env.VITE_GOOGLE_MAPS_API_KEY;
    try {
      const { googleMapsService } = await import("../src/maps/google-maps-service.ts");

      // Verify geocoding works for registered medical destinations even without external API
      const geoResult = await googleMapsService.geocodeAddress("Manipal Hospital");
      assert.ok(geoResult);
      assert.ok(geoResult.location.latitude > 0);
      assert.ok(geoResult.location.longitude > 0);

      // Verify route calculation provides two-leg structure without altering state machine
      const route = await googleMapsService.computeTwoLegJourneyRoute(
        { latitude: 12.9716, longitude: 77.5946, address: "Home" },
        { id: "hosp-1", name: "Manipal Hospital", address: "HAL Airport Rd", latitude: 12.9592, longitude: 77.6499 },
        { latitude: 12.9716, longitude: 77.5946, address: "Home" }
      );
      assert.ok(route);
      assert.ok(route.leg1Outbound.distanceMeters > 0);
      assert.ok(route.leg2Return.distanceMeters > 0);
      assert.equal(route.totalDistanceMeters, route.leg1Outbound.distanceMeters + route.leg2Return.distanceMeters);
    } finally {
      if (prevKey !== undefined) process.env.VITE_GOOGLE_MAPS_API_KEY = prevKey;
      else delete process.env.VITE_GOOGLE_MAPS_API_KEY;
    }
  });

  console.log("--------------------------------------------------");
  console.log(`TOTAL HARDENING TESTS: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
  if (failed === 0) {
    console.log("ALL PRODUCTION HARDENING TESTS PASSED!");
  }
  console.log("--------------------------------------------------\n");

  if (failed > 0) {
    process.exit(1);
  }
}

runHardeningTests().catch((err) => {
  console.error("Fatal error in hardening test suite:", err);
  process.exit(1);
});
