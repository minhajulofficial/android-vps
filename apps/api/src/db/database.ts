import fs from 'node:fs';
import path from 'node:path';
import type { DatabaseSync as SqliteDatabase } from 'node:sqlite';
import { resolveAbsolutePath } from '../config.js';

/**
 * Load node:sqlite through process.getBuiltinModule so that bundlers/tools
 * (Vitest/Vite included) hand it to Node natively instead of trying to
 * resolve the bare "sqlite" specifier on disk.
 */
const sqliteModule = (process as unknown as { getBuiltinModule(id: string): unknown }).getBuiltinModule(
  'node:sqlite'
) as { DatabaseSync: typeof import('node:sqlite').DatabaseSync };

/**
 * SQLite is used behind a small repository abstraction. It runs on Node's
 * built-in `node:sqlite` (no native compilation, zero third-party C deps), so
 * the same code runs identically in development, CI and on the production VPS.
 *
 * Tables:
 *   users             admins + normal users (role separates admin vs user)
 *   instances         the Android instances (lifecycle state + resource limits)
 *   instance_configs  key/value extra configuration per instance
 *   instance_events   lifecycle event log per instance (start/stop/error/...)
 *   audit_logs        security/action audit trail (who did what, when)
 */
export interface Db extends SqliteDatabase {
  applyMigrations(): void;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin','user')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS instances (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL UNIQUE,
  status          TEXT NOT NULL DEFAULT 'stopped'
                  CHECK (status IN ('stopped','starting','running','stopping','error')),
  runtime         TEXT NOT NULL DEFAULT 'docker',
  android_version TEXT NOT NULL DEFAULT '',
  cpu_limit       INTEGER NOT NULL DEFAULT 2,
  memory_limit_mb INTEGER NOT NULL DEFAULT 2048,
  storage_limit_gb INTEGER NOT NULL DEFAULT 20,
  vnc_port        INTEGER,
  adb_port        INTEGER,
  display_url     TEXT,
  owner_id        TEXT,
  error_message   TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS instance_configs (
  instance_id TEXT NOT NULL,
  key         TEXT NOT NULL,
  value       TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (instance_id, key),
  FOREIGN KEY (instance_id) REFERENCES instances(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS instance_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  instance_id TEXT NOT NULL,
  type        TEXT NOT NULL,
  message     TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (instance_id) REFERENCES instances(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT,
  action     TEXT NOT NULL,
  target     TEXT NOT NULL DEFAULT '',
  meta       TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_instances_status ON instances(status);
CREATE INDEX IF NOT EXISTS idx_instances_owner ON instances(owner_id);
CREATE INDEX IF NOT EXISTS idx_events_instance ON instance_events(instance_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);
`;

export function openDatabase(dbPath: string): Db {
  const isMemory = dbPath === ':memory:';
  const absolute = isMemory ? dbPath : resolveAbsolutePath(dbPath);
  if (!isMemory) {
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
  }
  const db = new sqliteModule.DatabaseSync(absolute) as Db;
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  (db as Db).applyMigrations = function applyMigrations(): void {
    this.exec(SCHEMA);
  };
  return db as Db;
}