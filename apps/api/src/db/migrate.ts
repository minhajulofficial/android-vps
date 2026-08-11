import { loadConfig } from '../config.js';
import { openDatabase } from './database.js';

/**
 * Apply schema migrations to the configured database.
 * Usage: npm run db:migrate
 */
const config = loadConfig();
const db = openDatabase(config.DB_PATH);
db.applyMigrations();
console.log(`[db:migrate] migrations applied to ${config.DB_PATH}`);
db.close();