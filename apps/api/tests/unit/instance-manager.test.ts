import { describe, expect, it, beforeAll } from 'vitest';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig, type AppConfig } from '../../src/config.js';
import { openDatabase } from '../../src/db/database.js';
import { createInstanceRepo } from '../../src/db/instance-repo.js';
import { createConfigRepo } from '../../src/db/config-repo.js';
import { createEventsRepo } from '../../src/db/event-repo.js';
import { FakeAdapter } from '../../src/runtime/adapters/fake.js';
import { InstanceManager } from '../../src/runtime/instance-manager.js';

let config: AppConfig;
let manager: InstanceManager;
let dbPath: string;

const actor = { id: 'admin-1', username: 'admin', role: 'admin' as const };

beforeAll(() => {
  dbPath = path.join(mkdtempSync(path.join(os.tmpdir(), 'avps-mgr-')), 'test.db');
  config = loadConfig({
    DB_PATH: dbPath,
    RUNTIME_DRIVER: 'fake',
    PUBLIC_URL: 'http://localhost:3000',
    MIN_FREE_MEMORY_MB: 0,
    MIN_FREE_DISK_GB: 0,
    RATE_LIMIT_MAX: 0,
    DEFAULT_MEMORY_LIMIT_MB: 1024,
    DEFAULT_CPU_LIMIT: 1,
    DEFAULT_STORAGE_LIMIT_GB: 5
  });
  const db = openDatabase(dbPath);
  db.applyMigrations();
  manager = new InstanceManager({
    config,
    repo: createInstanceRepo(db),
    configs: createConfigRepo(db),
    events: createEventsRepo(db),
    audit: { add: () => undefined },
    adapter: new FakeAdapter()
  });
});

describe('InstanceManager (fake driver)', () => {
  it('creates an instance with resource limits and ports', async () => {
    const view = await manager.create(
      { name: 'android-01', cpuLimit: 1, memoryLimitMb: 1024, storageLimitGb: 10 },
      actor
    );
    expect(view.name).toBe('android-01');
    expect(view.status).toBe('stopped');
    expect(view.cpu_limit).toBe(1);
    expect(view.memory_limit_mb).toBe(1024);
    expect(view.vnc_port).toBeGreaterThanOrEqual(config.VNC_PORT_START);
    expect(view.liveStatus.kind).toBe('stopped');
  });

  it('rejects duplicate names', async () => {
    await expect(manager.create({ name: 'android-01' }, actor)).rejects.toMatchObject({
      code: 'CONFLICT'
    });
  });

  it('runs the full life cycle: start → running → stop → stopped', async () => {
    const created = await manager.create({ name: 'cyc-01' }, actor);
    const running = await manager.start(created.id, actor);
    expect(running.status).toBe('running');
    expect(running.liveStatus.kind).toBe('running');
    expect(running.display_url).toBe('http://localhost:3000/instance/' + created.id);

    const status = await manager.view(created.id);
    expect(status.status).toBe('running');

    const stopped = await manager.stop(created.id, actor);
    expect(stopped.status).toBe('stopped');
  });

  it('refuses to start twice', async () => {
    const created = await manager.create({ name: 'dup-start' }, actor);
    await manager.start(created.id, actor);
    await expect(manager.start(created.id, actor)).rejects.toMatchObject({ code: 'INSTANCE_ALREADY_RUNNING' });
    await manager.stop(created.id, actor);
  });

  it('refuses to stop a stopped instance', async () => {
    const created = await manager.create({ name: 'never-ran' }, actor);
    await expect(manager.stop(created.id, actor)).rejects.toMatchObject({ code: 'INSTANCE_NOT_RUNNING' });
  });

  it('restarts a running instance', async () => {
    const created = await manager.create({ name: 'cyc-restart' }, actor);
    await manager.start(created.id, actor);
    const restarted = await manager.restart(created.id, actor);
    expect(restarted.status).toBe('running');
    await manager.stop(created.id, actor);
  });

  it('destroys instances and frees their resources', async () => {
    const created = await manager.create({ name: 'to-destroy' }, actor);
    const result = await manager.destroy(created.id, actor);
    expect(result.id).toBe(created.id);
    let thrown: unknown = null;
    try {
      manager.requireInstance(created.id);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toMatchObject({ code: 'INSTANCE_NOT_FOUND' });
  });

  it('rejects create when RAM is insufficient', async () => {
    const hugeMb = os.freemem() / 1024 / 1024 + 2_000_000;
    await expect(manager.create({ name: 'too-big', memoryLimitMb: Math.floor(hugeMb) }, actor)).rejects.toMatchObject({
      code: 'INSUFFICIENT_RESOURCES'
    });
  });

  it('returns logs for a running instance', async () => {
    const created = await manager.create({ name: 'loggy' }, actor);
    await manager.start(created.id, actor);
    const logs = await manager.logs(created.id, 50);
    expect(logs.lines).toContain('VNC display ready');
    await manager.stop(created.id, actor);
  });
});