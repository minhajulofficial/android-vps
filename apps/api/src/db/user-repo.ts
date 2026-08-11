import type { Db } from './database.js';

export type UserRole = 'admin' | 'user';

export interface UserRow {
  id: string;
  username: string;
  password_hash: string;
  role: UserRole;
  created_at: string;
  updated_at: string;
}

export type UserSummary = Omit<UserRow, 'password_hash'>;

export function publicUser(u: UserRow): UserSummary {
  return { id: u.id, username: u.username, role: u.role, created_at: u.created_at, updated_at: u.updated_at };
}

export function createUserRepo(db: Db) {
  return {
    create(user: Omit<UserRow, 'created_at' | 'updated_at'>): UserRow {
      const now = new Date().toISOString();
      const full: UserRow = { ...user, created_at: now, updated_at: now };
      db.prepare('INSERT INTO users (id, username, password_hash, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(
        full.id,
        full.username,
        full.password_hash,
        full.role,
        full.created_at,
        full.updated_at
      );
      return full;
    },

    findByUsername(username: string): UserRow | undefined {
      return db.prepare('SELECT * FROM users WHERE username = ?').get(username) as unknown as
        | UserRow
        | undefined;
    },

    findById(id: string): UserRow | undefined {
      return db.prepare('SELECT * FROM users WHERE id = ?').get(id) as unknown as UserRow | undefined;
    },

    count(): number {
      return (db.prepare('SELECT COUNT(*) AS c FROM users').get() as unknown as { c: number }).c;
    }
  };
}