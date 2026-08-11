import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

import { type AppConfig, loadConfig, resolveAbsolutePath } from './config.js';
import { loggerOptions } from './logger.js';
import { openDatabase } from './db/database.js';
import { createUserRepo } from './db/user-repo.js';
import { createInstanceRepo } from './db/instance-repo.js';
import { createConfigRepo } from './db/config-repo.js';
import { createEventsRepo, createAuditRepo } from './db/event-repo.js';
import { createTokenService } from './auth/jwt.js';
import { hashPassword } from './auth/password.js';
import { RateLimiter } from './security/rate-limit.js';
import { RealCommandRunner } from './runtime/command-runner.js';
import { selectDriver, futureAdapters } from './runtime/detect.js';
import { InstanceManager } from './runtime/instance-manager.js';
import { AppError } from './utils/errors.js';
import { fail } from './utils/api-response.js';
import {
  registerAuthRoutes,
  registerInstanceRoutes,
  registerHealthRoute,
  registerVncRoutes
} from './routes/index.js';
import './plugins/context.js';

export interface BuiltApp {
  app: FastifyInstance;
  config: AppConfig;
  dbPath: string;
}

export async function buildApp(configOverrides: Partial<AppConfig> = {}): Promise<BuiltApp> {
  const config = loadBase(configOverrides);

  const db = openDatabase(config.DB_PATH);
  db.applyMigrations();
  seedAdminIfEmpty(db, config);

  const users = createUserRepo(db);
  const repo = createInstanceRepo(db);
  const configs = createConfigRepo(db);
  const events = createEventsRepo(db);
  const audit = createAuditRepo(db);

  const tokens = createTokenService(config.JWT_SECRET, config.JWT_EXPIRES_IN);
  const runner = new RealCommandRunner(
    config.QEMU_BIN ? { qemu: config.QEMU_BIN } : {}
  );
  const { driver, driverId, reason } = await selectDriver(config, runner);

  const manager = new InstanceManager({
    config,
    repo,
    configs,
    events,
    audit: { add: (input) => audit.add(input) },
    adapter: driver
  });

  const app = Fastify({
    logger: loggerOptions(config.LOG_LEVEL),
    trustProxy: config.TRUST_PROXY,
    bodyLimit: 1024 * 1024,
    requestTimeout: 30_000
  });

  /* ------------------------------------------------- application context */
  app.decorate('authServices', { tokens, users });
  app.decorate('manager', manager);
  app.decorate('appConfig', config);
  app.decorate('limiter', RateLimiter.create({ windowSeconds: config.RATE_LIMIT_WINDOW_SECONDS, max: config.RATE_LIMIT_MAX, enabled: config.RATE_LIMIT_MAX > 0 }));
  app.decorate('loginConfig', { maxAttempts: config.LOGIN_MAX_ATTEMPTS, lockoutSeconds: config.LOGIN_LOCKOUT_SECONDS });
  app.decorate('runtime', {
    driverId,
    driverLabel: driver.label,
    availability: () => manager.availability(),
    futureDrivers: () => futureAdapters().map((d) => ({ id: d.id, label: d.label }))
  });
  app.decorate('audit', (input: { user_id: string | null; action: string; target: string; meta: string }) =>
    audit.add(input)
  );

  /* ------------------------------------------------- static + websocket */
  const webRoot = path.resolve(process.cwd(), config.WEB_ROOT);
  await app.register(fastifyStatic, {
    root: webRoot,
    prefix: '/',
    wildcard: false,
    index: false
  });
  app.get('/', async (_req, reply) => reply.sendFile('index.html'));
  await app.register(fastifyWebsocket);

  /* ------------------------------------------------- routes */
  registerHealthRoute(app);
  registerAuthRoutes(app);
  registerInstanceRoutes(app);
  registerVncRoutes(app);

  /* ------------------------------------------------- error handling */
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) {
      return reply.code(err.httpStatus).send(fail(err));
    }
    if (err instanceof z.ZodError) {
      const appErr = new AppError({
        code: 'VALIDATION_ERROR',
        message: 'Invalid input',
        details: err.flatten().fieldErrors
      });
      return reply.code(400).send(fail(appErr));
    }
    // Fastify body/request validation errors (400) — convert to the envelope.
    if (err.validation || err.statusCode === 400) {
      const appErr = new AppError({ code: 'VALIDATION_ERROR', message: 'Invalid request', details: err.message });
      return reply.code(400).send(fail(appErr));
    }
    req.log.error({ err, event: 'http.unhandled_error' }, 'unhandled error');
    const internal = new AppError({ code: 'INTERNAL_ERROR', message: 'Internal server error' });
    return reply.code(500).send(fail(internal));
  });

  app.setNotFoundHandler((req, reply) => {
    const notFound = new AppError({ code: 'NOT_FOUND', message: `Route ${req.method} ${req.url} not found` });
    return reply.code(404).send(fail(notFound));
  });

  app.log.info({ event: 'server.built', driver: driverId, driverReason: reason }, 'application initialized');

  return { app, config, dbPath: config.DB_PATH };
}

/** Load config from env with explicit overrides (used by tests). */
function loadBase(overrides: Partial<AppConfig>): AppConfig {
  return loadConfig(overrides);
}

function seedAdminIfEmpty(db: import('./db/database.js').Db, config: AppConfig): void {
  const users = createUserRepo(db);
  if (users.count() === 0) {
    users.create({
      id: randomUUID(),
      username: config.ADMIN_USERNAME,
      password_hash: hashPassword(config.ADMIN_PASSWORD),
      role: 'admin'
    });
    // Never log the password; log only that seeding happened.
    console.log(`[bootstrap] seeded initial admin user "${config.ADMIN_USERNAME}" (role=admin)`);
  }
}

export { resolveAbsolutePath };