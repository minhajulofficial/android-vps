import { z } from 'zod';

/** Instance names: lowercase start, then lowercase/digits/hyphens, max 63 chars. */
export const instanceNameSchema = z
  .string()
  .min(2)
  .max(63)
  .regex(/^[a-z0-9][a-z0-9-]*$/, 'name may only contain lowercase letters, digits and hyphens');

export const instanceIdSchema = z
  .string()
  .min(6)
  .max(24)
  .regex(/^[a-zA-Z0-9-]+$/, 'instance id contains invalid characters');

/** Strict limits applied before the manager performs resource checks. */
export interface CreateInstanceLimits {
  maxCpu: number;
  maxMemoryMb: number;
  defaultCpu: number;
  defaultMemoryMb: number;
  defaultStorageGb: number;
}

export function createInstanceSchema(limits: CreateInstanceLimits) {
  return z.object({
    name: instanceNameSchema,
    cpu_limit: z.number().int().min(1).max(limits.maxCpu).optional(),
    memory_limit_mb: z.number().int().min(512).max(limits.maxMemoryMb).optional(),
    storage_limit_gb: z.number().int().min(1).max(500).optional(),
    android_version: z.string().max(64).optional().or(z.literal('')),
    driver: z.enum(['docker', 'qemu']).optional()
  });
}

export const loginSchema = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(256)
});

export const logsQuerySchema = z.object({
  lines: z.coerce.number().int().min(1).max(2000).default(200)
});

export type LoginInput = z.infer<typeof loginSchema>;
export type CreateInstanceInput = z.infer<ReturnType<typeof createInstanceSchema>>;