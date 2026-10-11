import serverless from 'serverless-http';
import dotenv from 'dotenv';
import { PostgresDatabaseDriver, InMemoryRelationalDriver } from '../../src/server/db/driver.ts';
import { PostgresDomainStore } from '../../src/server/db/repositories/postgres-repositories.ts';
import { JourneyService } from '../../src/services/journey-service.ts';
import { createApiApp } from '../../src/server/api/app.ts';

dotenv.config();

// Module-level caching for serverless warm invocations
let cachedHandler: any = null;
let cachedDriver: PostgresDatabaseDriver | InMemoryRelationalDriver | null = null;
let cachedJourneyService: JourneyService | null = null;
let initPromise: Promise<any> | null = null;

/**
 * Initializes the server-side persistence and Express application
 * for Netlify Serverless execution.
 *
 * CRITICAL SAFETY RULES:
 * 1. Does NOT call app.listen().
 * 2. Does NOT execute database migrations (runMigrations) during requests or cold starts.
 * 3. Does NOT execute database seeding (seedInitialDomainData) in production or serverless invocations.
 * 4. Configures low PostgreSQL connection pool limit with connection reuse.
 */
async function initializeServerlessApp(): Promise<any> {
  const isProduction = process.env.NODE_ENV === 'production';
  const hasPgConfig = Boolean(process.env.DATABASE_URL || process.env.DATABASE_HOST);

  let dbDriver: PostgresDatabaseDriver | InMemoryRelationalDriver;

  if (isProduction) {
    if (!hasPgConfig) {
      const errMsg =
        '[Neravu Netlify API] Fatal configuration error: DATABASE_URL is mandatory in production environment. In-memory database fallback is strictly forbidden.';
      console.error(errMsg);
      throw new Error(errMsg);
    }
    // Production PostgreSQL driver with serverless connection pooling
    dbDriver = new PostgresDatabaseDriver(undefined, { isServerless: true });
    await dbDriver.connect();
  } else {
    // Development / non-production environment: fallback gracefully if PostgreSQL is unreachable
    if (hasPgConfig) {
      try {
        dbDriver = new PostgresDatabaseDriver(undefined, { isServerless: true });
        await dbDriver.connect();
      } catch (err: any) {
        console.warn(
          '[Neravu Netlify API] PostgreSQL connection failed in non-production. Falling back to InMemoryRelationalDriver:',
          err?.message || err
        );
        dbDriver = new InMemoryRelationalDriver();
      }
    } else {
      dbDriver = new InMemoryRelationalDriver();
    }
  }

  cachedDriver = dbDriver;
  const domainStore = new PostgresDomainStore(dbDriver);
  const journeyService = new JourneyService(domainStore);
  cachedJourneyService = journeyService;

  // Initialize the existing modular Express app
  // PaymentService, ServerAuthService, and Webhook rawBody parsing are wired inside createApiApp
  const app = createApiApp(journeyService);

  // Normalize path if Netlify forwards requests with /.netlify/functions/api prefix
  app.use((req, _res, next) => {
    if (req.url.startsWith('/.netlify/functions/api')) {
      req.url = req.url.replace('/.netlify/functions/api', '/api') || '/';
    }
    next();
  });

  // Wrap express app using serverless-http without app.listen()
  cachedHandler = serverless(app, {
    binary: [
      'image/*',
      'application/pdf',
      'application/octet-stream',
    ],
  });

  return cachedHandler;
}

/**
 * Returns or initializes the cached serverless-http handler.
 */
export async function getServerlessHandler(): Promise<any> {
  if (cachedHandler) {
    return cachedHandler;
  }
  if (!initPromise) {
    initPromise = initializeServerlessApp().catch((err) => {
      initPromise = null;
      throw err;
    });
  }
  return initPromise;
}

/**
 * For diagnostic / testing inspection in unit tests without touching production data.
 */
export function getCachedServices() {
  return {
    driver: cachedDriver,
    journeyService: cachedJourneyService,
    isInitialized: cachedHandler !== null,
  };
}

/**
 * Netlify Function main entry point.
 */
export const handler = async (event: any, context: any = {}) => {
  // Prevent Lambda from waiting indefinitely for empty event loop timers
  if (context) {
    context.callbackWaitsForEmptyEventLoop = false;
  }

  // Handle path rewrite if Netlify passes /.netlify/functions/api path directly in event
  if (event.path && event.path.startsWith('/.netlify/functions/api')) {
    event.path = event.path.replace(/^\/\.netlify\/functions\/api/, '/api');
    if (!event.path) {
      event.path = '/api';
    }
  }

  const serverlessFn = await getServerlessHandler();
  return serverlessFn(event, context);
};
