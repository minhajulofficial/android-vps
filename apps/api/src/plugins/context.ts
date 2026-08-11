import type { InstanceManager } from '../runtime/instance-manager.js';
import type { RateLimiter } from '../security/rate-limit.js';
import type { AdapterAvailability } from '../runtime/types.js';
import type { AppConfig } from '../config.js';

/**
 * Decorate Fastify instance with the application context. Everything is
 * initialized in app.ts and accessed via these typed fields.
 * `authServices` is declared in ../auth/auth-context.ts.
 */
declare module 'fastify' {
  interface FastifyInstance {
    manager?: InstanceManager;
    runtime?: {
      driverId: string;
      driverLabel: string;
      availability(): Promise<AdapterAvailability>;
      futureDrivers(): { id: string; label: string }[];
    };
    limiter?: RateLimiter;
    loginConfig?: { maxAttempts: number; lockoutSeconds: number };
    appConfig?: AppConfig;
    /** Append an entry to the audit log. */
    audit?: (input: {
      user_id: string | null;
      action: string;
      target: string;
      meta: string;
    }) => void;
  }
}