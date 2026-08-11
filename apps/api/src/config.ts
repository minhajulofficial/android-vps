import fs from 'node:fs';
import path from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  PUBLIC_URL: z.string().url().or(z.literal('')).default('http://localhost:3000'),
  WEB_ROOT: z.string().default('../web'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']).default('info'),

  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters').default('dev-only-secret-change-me'),
  JWT_EXPIRES_IN: z.string().default('8h'),

  ADMIN_USERNAME: z.string().min(1).default('admin'),
  ADMIN_PASSWORD: z.string().min(8, 'ADMIN_PASSWORD must be at least 8 characters').default('admin-password'),

  DB_PATH: z.string().default('./data/android-vps.db'),

  RUNTIME_DRIVER: z.enum(['auto', 'docker', 'qemu', 'fake']).default('auto'),

  REDROID_IMAGE: z.string().default('redroid/redroid:14.0.0-latest'),
  REDROID_ANDROID_VERSION: z.string().default('Android 14'),
  DROIDVNC_APK_URL: z.string().url().optional(),

  QEMU_ANDROID_IMAGE: z.string().default('/opt/android-vps/images/android-x86_64.img'),
  QEMU_BIN: z.string().default('qemu-system-x86_64'),
  QEMU_ANDROID_VERSION: z.string().default('Android 9 (x86_64)'),
  INSTANCES_DIR: z.string().default('/var/lib/android-vps'),

  VNC_PORT_START: z.coerce.number().int().min(1).default(5900),
  VNC_PORT_END: z.coerce.number().int().min(1).default(5999),
  ADB_PORT_START: z.coerce.number().int().min(1).default(5555),
  ADB_PORT_END: z.coerce.number().int().min(1).default(5564),

  DEFAULT_CPU_LIMIT: z.coerce.number().int().min(1).default(2),
  DEFAULT_MEMORY_LIMIT_MB: z.coerce.number().int().min(256).default(4096),
  DEFAULT_STORAGE_LIMIT_GB: z.coerce.number().int().min(1).default(20),
  MAX_CPU_PER_INSTANCE: z.coerce.number().int().min(1).default(8),
  MAX_MEMORY_PER_INSTANCE_MB: z.coerce.number().int().min(512).default(8192),
  MIN_FREE_MEMORY_MB: z.coerce.number().int().min(0).default(2048),
  MIN_FREE_DISK_GB: z.coerce.number().int().min(0).default(5),

  LOGIN_MAX_ATTEMPTS: z.coerce.number().int().min(1).default(5),
  LOGIN_LOCKOUT_SECONDS: z.coerce.number().int().min(0).default(300),
  RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().min(1).default(60),
  RATE_LIMIT_MAX: z.coerce.number().int().min(0).default(300),

  HEALTH_INTERVAL_SECONDS: z.coerce.number().int().min(1).default(30),

  /** Trust X-Forwarded-For when running behind a reverse proxy (nginx). */
  TRUST_PROXY: z.coerce.boolean().default(false)
});

export type AppConfig = z.infer<typeof envSchema>;

/**
 * Locate the project `.env` file. When the API runs through the npm workspace
 * the current working directory is `apps/api`, but users keep `.env` at the
 * repository root — so walk up from the cwd until a `.env` is found.
 */
function resolveEnvPath(): string {
  let dir = process.cwd();
  for (let depth = 0; depth < 6; depth++) {
    const candidate = path.join(dir, '.env');
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.join(process.cwd(), '.env');
}

export function loadConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  loadDotenv({ path: resolveEnvPath() });
  const parsed = envSchema.safeParse({ ...process.env, ...overrides });
  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment configuration: ${details}`);
  }
  return parsed.data;
}

export function resolveAbsolutePath(p: string, cwd: string = process.cwd()): string {
  return path.isAbsolute(p) ? p : path.resolve(cwd, p);
}