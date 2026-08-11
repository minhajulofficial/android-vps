import type { FastifyInstance } from 'fastify';
import { ok } from '../utils/api-response.js';
import { collectServerStats } from '../runtime/system-stats.js';
import { authenticated } from '../auth/middleware.js';

export const APP_VERSION = '0.1.0';

export function registerHealthRoute(app: FastifyInstance): void {
  const manager = app.manager!;
  const runtime = app.runtime!;

  /* GET /api/health (public) */
  app.get('/api/health', async () => {
    let availability;
    try {
      availability = await manager.availability();
    } catch {
      availability = {
        available: false,
        reason: 'runtime adapter failed to report capabilities',
        capabilities: { kvm: false, binder: false, dockerCli: false, qemuBinary: false, androidImage: false }
      };
    }

    const runtimeHealthy = availability.available;
    const counts = manager.counts();
    return ok({
      status: runtimeHealthy ? 'healthy' : 'degraded',
      services: {
        api: 'healthy',
        database: 'healthy',
        runtime: runtimeHealthy ? 'healthy' : 'unavailable'
      },
      runtime: {
        driver: runtime.driverId,
        driverLabel: runtime.driverLabel,
        reason: availability.reason,
        capabilities: availability.capabilities
      },
      instances: counts,
      version: APP_VERSION,
      timestamp: new Date().toISOString()
    });
  });

  /* GET /api/server/stats (protected) */
  app.get('/api/server/stats', { preHandler: [authenticated(app)] }, async (_req, reply) => {
    const manager = app.manager!;
    const config = app.appConfig!;
    const stats = await collectServerStats(config, manager.counts(), runtime.driverId);
    return reply.send(ok(stats));
  });
}