import { randomUUID } from 'node:crypto';
import type { Db } from './database.js';

export type InstanceStatus = 'stopped' | 'starting' | 'running' | 'stopping' | 'error';

export interface InstanceRow {
  id: string;
  name: string;
  status: InstanceStatus;
  runtime: string;
  android_version: string;
  cpu_limit: number;
  memory_limit_mb: number;
  storage_limit_gb: number;
  vnc_port: number | null;
  adb_port: number | null;
  display_url: string | null;
  owner_id: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateInstanceInput {
  name: string;
  runtime: string;
  android_version: string;
  cpu_limit: number;
  memory_limit_mb: number;
  storage_limit_gb: number;
  owner_id?: string | null;
  vnc_port?: number | null;
  adb_port?: number | null;
}

export function newId(): string {
  return randomUUID().replace(/-/g, '').slice(0, 12);
}

export type InstanceRepo = ReturnType<typeof createInstanceRepo>;

export function createInstanceRepo(db: Db) {
  return {
    create(input: CreateInstanceInput): InstanceRow {
      const id = newId();
      const now = new Date().toISOString();
      const row: InstanceRow = {
        id,
        name: input.name,
        status: 'stopped',
        runtime: input.runtime,
        android_version: input.android_version,
        cpu_limit: input.cpu_limit,
        memory_limit_mb: input.memory_limit_mb,
        storage_limit_gb: input.storage_limit_gb,
        vnc_port: input.vnc_port ?? null,
        adb_port: input.adb_port ?? null,
        display_url: null,
        owner_id: input.owner_id ?? null,
        error_message: null,
        created_at: now,
        updated_at: now
      };
      db.prepare(
        `INSERT INTO instances
           (id, name, status, runtime, android_version, cpu_limit, memory_limit_mb,
            storage_limit_gb, vnc_port, adb_port, display_url, owner_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        row.id,
        row.name,
        row.status,
        row.runtime,
        row.android_version,
        row.cpu_limit,
        row.memory_limit_mb,
        row.storage_limit_gb,
        input.vnc_port ?? null,
        input.adb_port ?? null,
        null,
        row.owner_id
      );
      return row;
    },

    findById(id: string): InstanceRow | undefined {
      return db.prepare('SELECT * FROM instances WHERE id = ?').get(id) as unknown as InstanceRow | undefined;
    },

    findByName(name: string): InstanceRow | undefined {
      return db.prepare('SELECT * FROM instances WHERE name = ?').get(name) as unknown as InstanceRow | undefined;
    },

    list(): InstanceRow[] {
      return db.prepare('SELECT * FROM instances ORDER BY created_at ASC').all() as unknown as InstanceRow[];
    },

    update(row: Partial<InstanceRow> & { id: string }): void {
      const existing = this.findById(row.id);
      if (!existing) throw new Error(`Instance ${row.id} does not exist`);
      const merged = { ...existing, ...row, updated_at: new Date().toISOString() };
      db.prepare(
        `UPDATE instances SET status=?, runtime=?, android_version=?, cpu_limit=?, memory_limit_mb=?,
           storage_limit_gb=?, vnc_port=?, adb_port=?, display_url=?, owner_id=?,
           error_message=?, updated_at=? WHERE id=?`
      ).run(
        merged.status,
        merged.runtime,
        merged.android_version,
        merged.cpu_limit,
        merged.memory_limit_mb,
        merged.storage_limit_gb,
        merged.vnc_port,
        merged.adb_port,
        merged.display_url,
        merged.owner_id,
        merged.error_message,
        merged.updated_at,
        merged.id
      );
    },

    setStatus(id: string, status: InstanceStatus, errorMessage: string | null = null): void {
      db.prepare(`UPDATE instances SET status=?, error_message=?, updated_at=datetime('now') WHERE id=?`).run(
        status,
        errorMessage,
        id
      );
    },

    remove(id: string): void {
      db.prepare('DELETE FROM instances WHERE id = ?').run(id);
    },

    countActive(): number {
      return (
        db.prepare(`SELECT COUNT(*) AS c FROM instances WHERE status IN ('running','starting')`).get() as unknown as {
          c: number;
        }
      ).c;
    },

    countByStatus(): Record<InstanceStatus, number> {
      const rows = db.prepare('SELECT status, COUNT(*) AS c FROM instances GROUP BY status').all() as unknown as {
        status: InstanceStatus;
        c: number;
      }[];
      const result: Record<InstanceStatus, number> = {
        stopped: 0,
        starting: 0,
        running: 0,
        stopping: 0,
        error: 0
      };
      for (const r of rows) result[r.status] = r.c;
      return result;
    }
  };
}