import os from 'node:os';
import type { AppConfig } from '../config.js';
import { AppError } from '../utils/errors.js';
import type { ConfigRepo } from '../db/config-repo.js';
import type { EventRepo } from '../db/event-repo.js';
import type { InstanceRepo, InstanceRow } from '../db/instance-repo.js';
import { collectDiskStat } from './system-stats.js';
import type { AdapterAvailability, InstanceSpec, RuntimeAdapter, RuntimeStatus } from './types.js';

export interface ManagerDeps {
  config: AppConfig;
  repo: InstanceRepo;
  configs: ConfigRepo;
  events: EventRepo;
  audit: { add(input: { user_id: string | null; action: string; target: string; meta: string }): void };
  adapter: RuntimeAdapter;
}

export interface CreateRequest {
  name: string;
  cpuLimit?: number;
  memoryLimitMb?: number;
  storageLimitGb?: number;
  androidVersion?: string;
  driver?: 'docker' | 'qemu';
}

export interface Actor {
  id: string | null;
  username: string;
  role: 'admin' | 'user';
}

export interface InstanceView extends InstanceRow {
  liveStatus: RuntimeStatus;
}

export class InstanceManager {
  private readonly reservedVnc = new Set<number>();
  private readonly reservedAdb = new Set<number>();
  private availabilityCache: { at: number; value: AdapterAvailability } | null = null;

  constructor(private readonly deps: ManagerDeps) {
    this.seedReservedPorts();
  }

  /* ---------------------------------------------------------------- availability */

  async availability(force = false): Promise<AdapterAvailability> {
    const now = Date.now();
    if (!force && this.availabilityCache && now - this.availabilityCache.at < 15_000) {
      return this.availabilityCache.value;
    }
    const value = await this.deps.adapter.available();
    this.availabilityCache = { at: now, value };
    return value;
  }

  driverId(): string {
    return this.deps.adapter.id;
  }

  /* ---------------------------------------------------------------- create */

  async create(req: CreateRequest, actor: Actor): Promise<InstanceView> {
    const name = req.name.trim();
    if (this.deps.repo.findByName(name)) {
      throw new AppError({ code: 'CONFLICT', message: `An instance named "${name}" already exists` });
    }

    const cpuLimit = req.cpuLimit ?? this.deps.config.DEFAULT_CPU_LIMIT;
    const memoryMb = req.memoryLimitMb ?? this.deps.config.DEFAULT_MEMORY_LIMIT_MB;
    const storageGb = req.storageLimitGb ?? this.deps.config.DEFAULT_STORAGE_LIMIT_GB;
    const androidVersion = req.androidVersion?.trim() || this.defaultAndroidVersion();
    const driver = req.driver ?? (this.deps.adapter.id === 'qemu' ? 'qemu' : 'docker');

    await this.assertResources(cpuLimit, memoryMb, storageGb);

    const vncPort = this.allocatePort(this.deps.config.VNC_PORT_START, this.deps.config.VNC_PORT_END, this.reservedVnc, 'VNC');
    let adbPort: number | null = null;
    try {
      adbPort = this.allocatePort(this.deps.config.ADB_PORT_START, this.deps.config.ADB_PORT_END, this.reservedAdb, 'ADB');
    } catch {
      adbPort = null; // ADB is best-effort
    }

const row = this.deps.repo.create({
      name,
      runtime: driver,
      android_version: androidVersion,
      cpu_limit: cpuLimit,
      memory_limit_mb: memoryMb,
      storage_limit_gb: storageGb,
      vnc_port: vncPort,
      adb_port: adbPort,
owner_id: actor.role === 'admin' ? null : actor.id
    });

    this.reservedVnc.add(vncPort);
    if (adbPort) this.reservedAdb.add(adbPort);
    this.deps.configs.set(row.id, 'display_mode', driver === 'qemu' ? 'vnc' : 'vnc');
    this.deps.events.add(row.id, 'created', `instance created (${driver}, ${cpuLimit} vCPU, ${memoryMb} MB RAM)`);
    this.deps.audit.add({
      user_id: actor.id,
      action: 'instance.created',
      target: row.id,
      meta: JSON.stringify({ name: row.name, driver })
    });

    return { ...row, liveStatus: { kind: 'stopped' } };
  }

  /* ---------------------------------------------------------------- lifecycle */

  async start(id: string, actor: Actor): Promise<InstanceView> {
    const row = this.requireInstance(id);
    if (row.status === 'running' || row.status === 'starting') {
      throw new AppError({ code: 'INSTANCE_ALREADY_RUNNING', message: `Instance "${row.name}" is already running` });
    }
    const avail = await this.availability(true);
    if (!avail.available) {
      throw new AppError({ code: 'RUNTIME_UNAVAILABLE', message: avail.reason });
    }
    if (row.status === 'error') await this.deps.repo.setStatus(id, 'stopped', null);
    this.deps.repo.setStatus(id, 'starting');
    this.deps.events.add(id, 'starting', `starting on driver ${this.driverId()} (${avail.reason})`);
    this.deps.audit.add({ user_id: actor.id, action: 'instance.start', target: id, meta: '{}' });

    const spec = this.buildSpec(row);
    try {
      await this.deps.adapter.start(spec);
    } catch (err) {
      const message = err instanceof AppError ? err.message : (err as Error).message;
      this.deps.repo.setStatus(id, 'error', message);
      this.deps.events.add(id, 'error', message);
      this.deps.audit.add({ user_id: actor.id, action: 'instance.start.failed', target: id, meta: JSON.stringify({ message }) });
      throw err instanceof AppError
        ? err
        : new AppError({ code: 'DRIVER_ERROR', message: `failed to start "${row.name}": ${message}` });
    }

    const displayUrl = `${this.deps.config.PUBLIC_URL}/instance/${id}`;
    this.deps.repo.update({ id, status: 'running', display_url: displayUrl });
    this.deps.events.add(id, 'started', `instance started (VNC ${spec.vncPort}${spec.adbPort ? `, ADB ${spec.adbPort}` : ''})`);
    return this.view(id);
  }

  async stop(id: string, actor: Actor): Promise<InstanceView> {
    const row = this.requireInstance(id);
    if (row.status === 'stopped') {
      throw new AppError({ code: 'INSTANCE_NOT_RUNNING', message: `Instance "${row.name}" is not running` });
    }
    this.deps.repo.setStatus(id, 'stopping');
    this.deps.events.add(id, 'stopping', 'stopping instance');
    this.deps.audit.add({ user_id: actor.id, action: 'instance.stop', target: id, meta: '{}' });
    try {
      await this.deps.adapter.stop(this.buildSpec(row));
    } catch (err) {
      const message = (err as Error).message;
      this.deps.repo.setStatus(id, 'error', message);
      this.deps.events.add(id, 'error', message);
      throw new AppError({ code: 'DRIVER_ERROR', message: `failed to stop "${row.name}": ${message}` });
    }
    this.deps.repo.setStatus(id, 'stopped');
    this.deps.events.add(id, 'stopped', 'instance stopped');
    return this.view(id);
  }

  async restart(id: string, actor: Actor): Promise<InstanceView> {
    const row = this.requireInstance(id);
    if (row.status === 'running' || row.status === 'starting') {
      await this.stop(id, actor);
    }
    return this.start(id, actor);
  }

  async destroy(id: string, actor: Actor): Promise<{ id: string; name: string }> {
    const row = this.requireInstance(id);
    if (row.status === 'running' || row.status === 'starting' || row.status === 'error') {
      try {
        await this.deps.adapter.stop(this.buildSpec(row));
      } catch {
        /* best effort during destroy */
      }
    }
    try {
      await this.deps.adapter.destroy(this.buildSpec(row));
    } catch {
      /* best effort */
    }
    if (row.vnc_port) this.reservedVnc.delete(row.vnc_port);
    if (row.adb_port) this.reservedAdb.delete(row.adb_port);
    this.deps.repo.remove(id);
    this.deps.audit.add({ user_id: actor.id, action: 'instance.destroyed', target: id, meta: JSON.stringify({ name: row.name }) });
    return { id, name: row.name };
  }

  /* ---------------------------------------------------------------- queries */

  requireInstance(id: string): InstanceRow {
    const row = this.deps.repo.findById(id);
    if (!row) {
      throw new AppError({ code: 'INSTANCE_NOT_FOUND', message: 'Android instance was not found' });
    }
    return row;
  }

  async view(id: string): Promise<InstanceView> {
    const row = this.requireInstance(id);
    const live = await this.adapterStatus(row);
    if (row.status === 'running' && live.kind === 'stopped') {
      // The runtime process disappeared while we thought it was running.
      this.deps.repo.setStatus(id, 'error', 'runtime process not found (crashed or was killed externally)');
      this.deps.events.add(id, 'error', 'runtime process not found during status check');
      return this.view(id);
    }
    return { ...row, liveStatus: live };
  }

  async list(ownerId?: string | null): Promise<InstanceView[]> {
    let rows = this.deps.repo.list();
    if (ownerId) rows = rows.filter((r) => r.owner_id === ownerId || r.owner_id === null);
    const views: InstanceView[] = [];
    for (const row of rows) {
      const running = row.status === 'running' || row.status === 'starting';
      const live = running ? await this.adapterStatus(row) : ({ kind: 'stopped' } as const);
      views.push({ ...row, liveStatus: live });
    }
    return views;
  }

  async logs(id: string, lines: number): Promise<{ instance_id: string; lines: string }> {
    const row = this.requireInstance(id);
    const { text } = await this.deps.adapter.logs(this.buildSpec(row), lines);
    return { instance_id: id, lines: text };
  }

  counts(): { total: number; running: number; stopped: number } {
    const by = this.deps.repo.countByStatus();
    const total = by.running + by.starting + by.stopped + by.stopping + by.error;
    return { total, running: by.running + by.starting, stopped: by.stopped };
  }

  /* ---------------------------------------------------------------- internals */

  private async adapterStatus(row: InstanceRow): Promise<RuntimeStatus> {
    try {
      return await this.deps.adapter.status(this.buildSpec(row));
    } catch {
      return { kind: 'stopped' };
    }
  }

  private buildSpec(row: InstanceRow): InstanceSpec {
    return {
      id: row.id,
      name: row.name,
      androidVersion: row.android_version,
      cpu: row.cpu_limit,
      memoryMb: row.memory_limit_mb,
      storageGb: row.storage_limit_gb,
      vncPort: row.vnc_port ?? 0,
      adbPort: row.adb_port,
      configs: this.deps.configs.all(row.id)
    };
  }

  private defaultAndroidVersion(): string {
    return this.deps.adapter.id === 'qemu' ? this.deps.config.QEMU_ANDROID_VERSION : this.deps.config.REDROID_ANDROID_VERSION;
  }

  private async assertResources(cpu: number, memoryMb: number, storageGb: number): Promise<void> {
    const hostCpus = os.cpus().length;

    const runningRows = this.deps.repo.list().filter((r) => r.status === 'running' || r.status === 'starting');
    const usedCpu = runningRows.reduce((sum, r) => sum + r.cpu_limit, 0);
    const usedMem = runningRows.reduce((sum, r) => sum + r.memory_limit_mb, 0);

    if (usedCpu + cpu > hostCpus) {
      throw new AppError({
        code: 'INSUFFICIENT_RESOURCES',
        message: `Not enough CPU available (${usedCpu}/${hostCpus} vCPU already in use, requested ${cpu})`
      });
    }

    const freeMemMb = Math.round(os.freemem() / 1024 / 1024);
    const minFree = this.deps.config.MIN_FREE_MEMORY_MB;
    if (usedMem + memoryMb > freeMemMb - minFree) {
      throw new AppError({
        code: 'INSUFFICIENT_RESOURCES',
        message: `Not enough RAM available (${usedMem} MB in use, ${freeMemMb} MB free, ${minFree} MB must remain, requested ${memoryMb} MB)`
      });
    }

    const disk = await collectDiskStat(this.deps.config.DB_PATH === ':memory:' ? '.' : this.deps.config.DB_PATH);
    const minFreeDisk = this.deps.config.MIN_FREE_DISK_GB;
    if (disk.freeGb - storageGb < minFreeDisk) {
      throw new AppError({
        code: 'INSUFFICIENT_RESOURCES',
        message: `Not enough disk space (${disk.freeGb} GB free, ${minFreeDisk} GB must remain, requested ${storageGb} GB)`
      });
    }
  }

  private allocatePort(start: number, end: number, reserved: Set<number>, label: string): number {
    for (let port = start; port <= end; port++) {
      if (!reserved.has(port)) return port;
    }
    throw new AppError({
      code: 'INSUFFICIENT_RESOURCES',
      message: `No free ${label} port available in range ${start}-${end}`
    });
  }

  private seedReservedPorts(): void {
    for (const r of this.deps.repo.list()) {
      if (r.vnc_port) this.reservedVnc.add(r.vnc_port);
      if (r.adb_port) this.reservedAdb.add(r.adb_port);
    }
  }
}