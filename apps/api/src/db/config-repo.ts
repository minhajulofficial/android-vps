import type { Db } from './database.js';

export function createConfigRepo(db: Db) {
  return {
    set(instanceId: string, key: string, value: string): void {
      db.prepare(
        `INSERT INTO instance_configs (instance_id, key, value) VALUES (?, ?, ?)
         ON CONFLICT(instance_id, key) DO UPDATE SET value = excluded.value`
      ).run(instanceId, key, value);
    },

    get(instanceId: string, key: string): string | undefined {
      const row = db
        .prepare('SELECT value FROM instance_configs WHERE instance_id = ? AND key = ?')
        .get(instanceId, key) as unknown as { value: string } | undefined;
      return row?.value;
    },

    all(instanceId: string): Record<string, string> {
      const rows = db
        .prepare('SELECT key, value FROM instance_configs WHERE instance_id = ?')
        .all(instanceId) as unknown as { key: string; value: string }[];
      return Object.fromEntries(rows.map((r) => [r.key, r.value]));
    }
  };
}

export type ConfigRepo = ReturnType<typeof createConfigRepo>;