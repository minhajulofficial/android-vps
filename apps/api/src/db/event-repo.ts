import type { Db } from './database.js';

export interface InstanceEventRow {
  id?: number;
  instance_id: string;
  type: string;
  message: string;
  created_at?: string;
}

export interface AuditLogRow {
  id?: number;
  user_id: string | null;
  action: string;
  target: string;
  meta: string;
  created_at?: string;
}

export function createEventsRepo(db: Db) {
  return {
    add(instanceId: string, type: string, message: string): void {
      db.prepare('INSERT INTO instance_events (instance_id, type, message) VALUES (?, ?, ?)').run(
        instanceId,
        type,
        message
      );
    },

    list(instanceId: string, limit: number): InstanceEventRow[] {
      const rows = db
        .prepare('SELECT * FROM instance_events WHERE instance_id = ? ORDER BY id DESC LIMIT ?')
        .all(instanceId, limit) as unknown as InstanceEventRow[];
      return rows;
    },

    lastType(instanceId: string): string | undefined {
      const row = db
        .prepare('SELECT type FROM instance_events WHERE instance_id = ? ORDER BY id DESC LIMIT 1')
        .get(instanceId) as unknown as { type: string } | undefined;
      return row?.type;
    }
  };
}

export type EventRepo = ReturnType<typeof createEventsRepo>;

export function createAuditRepo(db: Db) {
  return {
    add(input: Omit<AuditLogRow, 'created_at'>): void {
      db.prepare('INSERT INTO audit_logs (user_id, action, target, meta) VALUES (?, ?, ?, ?)').run(
        input.user_id,
        input.action,
        input.target,
        input.meta
      );
    },

    list(limit = 100): AuditLogRow[] {
      return db.prepare('SELECT * FROM audit_logs ORDER BY id DESC LIMIT ?').all(limit) as unknown as AuditLogRow[];
    }
  };
}

export type AuditRepo = ReturnType<typeof createAuditRepo>;