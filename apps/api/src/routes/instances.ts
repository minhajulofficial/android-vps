import type { FastifyInstance } from 'fastify';
import { authenticated, currentUser, requireAdmin } from '../auth/middleware.js';
import { AppError } from '../utils/errors.js';
import { ok } from '../utils/api-response.js';
import { instanceIdSchema, createInstanceSchema, logsQuerySchema, type CreateInstanceInput } from '../security/validation.js';
import type { InstanceRow } from '../db/instance-repo.js';

function parseId(raw: string): string {
  const parsed = instanceIdSchema.safeParse(raw);
  if (!parsed.success) {
    throw new AppError({ code: 'VALIDATION_ERROR', message: 'Invalid instance id', details: parsed.error.flatten().fieldErrors });
  }
  return parsed.data;
}

/** Admin can act on anything; normal users only on their own or shared instances. */
function canAccess(user: { role: 'admin' | 'user'; id: string }, row: InstanceRow): boolean {
  if (user.role === 'admin') return true;
  return row.owner_id === null || row.owner_id === user.id;
}

function assertAccess(user: { role: 'admin' | 'user'; id: string }, row: InstanceRow): void {
  if (!canAccess(user, row)) {
    throw new AppError({ code: 'FORBIDDEN', message: 'You do not have access to this instance' });
  }
}

export function registerInstanceRoutes(app: FastifyInstance): void {
  const manager = app.manager!;
  const config = app.appConfig!;

  /* GET /api/instances */
  app.get('/api/instances', { preHandler: [authenticated(app)] }, async (req, reply) => {
    const user = currentUser(req);
    const views = user.role === 'admin' ? await manager.list() : await manager.list(user.id);
    return reply.send(ok(views));
  });

  /* POST /api/instances */
  app.post('/api/instances', { preHandler: [authenticated(app)] }, async (req, reply) => {
    requireAdmin(req);
    const schema = createInstanceSchema({
      maxCpu: config.MAX_CPU_PER_INSTANCE,
      maxMemoryMb: config.MAX_MEMORY_PER_INSTANCE_MB,
      defaultCpu: config.DEFAULT_CPU_LIMIT,
      defaultMemoryMb: config.DEFAULT_MEMORY_LIMIT_MB,
      defaultStorageGb: config.DEFAULT_STORAGE_LIMIT_GB
    });
    const parsed = schema.safeParse(req.body as unknown);
    if (!parsed.success) {
      throw new AppError({ code: 'VALIDATION_ERROR', message: 'Invalid instance definition', details: parsed.error.flatten().fieldErrors });
    }
    const input = parsed.data as CreateInstanceInput;
    const user = currentUser(req);
    const view = await manager.create(
      {
        name: input.name,
        cpuLimit: input.cpu_limit,
        memoryLimitMb: input.memory_limit_mb,
        storageLimitGb: input.storage_limit_gb,
        androidVersion: input.android_version || undefined,
        driver: input.driver
      },
      { id: user.id, username: user.username, role: user.role }
    );
    app.log.info({ event: 'instance.created', id: view.id, name: view.name }, 'instance created');
    return reply.code(201).send(ok(view));
  });

  /* GET /api/instances/:id */
  app.get('/api/instances/:id', { preHandler: [authenticated(app)] }, async (req, reply) => {
    const user = currentUser(req);
    const id = parseId((req.params as { id: string }).id);
    const view = await manager.view(id);
    assertAccess(user, view);
    return reply.send(ok(view));
  });

  /* POST /api/instances/:id/start */
  app.post('/api/instances/:id/start', { preHandler: [authenticated(app)] }, async (req, reply) => {
    const user = currentUser(req);
    const id = parseId((req.params as { id: string }).id);
    assertAccess(user, manager.requireInstance(id));
    const view = await manager.start(id, { id: user.id, username: user.username, role: user.role });
    return reply.send(ok(view));
  });

  /* POST /api/instances/:id/stop */
  app.post('/api/instances/:id/stop', { preHandler: [authenticated(app)] }, async (req, reply) => {
    const user = currentUser(req);
    const id = parseId((req.params as { id: string }).id);
    assertAccess(user, manager.requireInstance(id));
    const view = await manager.stop(id, { id: user.id, username: user.username, role: user.role });
    return reply.send(ok(view));
  });

  /* POST /api/instances/:id/restart */
  app.post('/api/instances/:id/restart', { preHandler: [authenticated(app)] }, async (req, reply) => {
    const user = currentUser(req);
    const id = parseId((req.params as { id: string }).id);
    assertAccess(user, manager.requireInstance(id));
    const view = await manager.restart(id, { id: user.id, username: user.username, role: user.role });
    return reply.send(ok(view));
  });

  /* DELETE /api/instances/:id */
  app.delete('/api/instances/:id', { preHandler: [authenticated(app)] }, async (req, reply) => {
    requireAdmin(req);
    const id = parseId((req.params as { id: string }).id);
    const result = await manager.destroy(id, { id: currentUser(req).id, username: currentUser(req).username, role: 'admin' });
    return reply.send(ok(result));
  });

  /* GET /api/instances/:id/status */
  app.get('/api/instances/:id/status', { preHandler: [authenticated(app)] }, async (req, reply) => {
    const user = currentUser(req);
    const id = parseId((req.params as { id: string }).id);
    const view = await manager.view(id);
    assertAccess(user, view);
    return reply.send(ok({ id, status: view.status, live: view.liveStatus, error_message: view.error_message }));
  });

  /* GET /api/instances/:id/logs */
  app.get('/api/instances/:id/logs', { preHandler: [authenticated(app)] }, async (req, reply) => {
    const user = currentUser(req);
    const id = parseId((req.params as { id: string }).id);
    assertAccess(user, manager.requireInstance(id));
    const query = logsQuerySchema.safeParse(req.query);
    const lines = query.success ? query.data.lines : 200;
    return reply.send(ok(await manager.logs(id, lines)));
  });
}