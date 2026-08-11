import { loadConfig } from './src/config.js';
import { openDatabase } from './src/db/database.js';
import { hashPassword } from './src/auth/password.js';

const config = loadConfig();
const db = openDatabase(config.DB_PATH);
db.applyMigrations();
const result = db
  .prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE username = ?')
  .run(hashPassword(config.ADMIN_PASSWORD), new Date().toISOString(), config.ADMIN_USERNAME);
if (result.changes === 0) {
  console.log(`[reset] no user found with username "${config.ADMIN_USERNAME}"`);
} else {
  console.log(`[reset] password updated for "${config.ADMIN_USERNAME}" from current .env`);
}
db.close();