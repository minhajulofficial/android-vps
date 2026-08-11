import { randomUUID } from 'node:crypto';
import { loadConfig } from './config.js';
import { openDatabase } from './db/database.js';
import { createUserRepo } from './db/user-repo.js';
import { hashPassword } from './auth/password.js';

/**
 * Standalone admin bootstrap:  npm run seed:admin
 * Creates the first admin if no users exist yet. The password comes from the
 * environment (ADMIN_PASSWORD) and is never printed.
 */
const config = loadConfig();
const db = openDatabase(config.DB_PATH);
db.applyMigrations();
const users = createUserRepo(db);

if (users.count() > 0) {
  console.log('[seed:admin] users already exist — nothing to do.');
  db.close();
  process.exit(0);
}

users.create({
  id: randomUUID(),
  username: config.ADMIN_USERNAME,
  password_hash: hashPassword(config.ADMIN_PASSWORD),
  role: 'admin'
});
console.log(`[seed:admin] created admin user "${config.ADMIN_USERNAME}" (role=admin)`);
db.close();