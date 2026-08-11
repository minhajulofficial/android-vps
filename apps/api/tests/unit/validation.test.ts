import { describe, expect, it } from 'vitest';
import { instanceIdSchema, instanceNameSchema, createInstanceSchema, loginSchema } from '../../src/security/validation.js';

const LIMITS = { maxCpu: 8, maxMemoryMb: 8192, defaultCpu: 2, defaultMemoryMb: 4096, defaultStorageGb: 20 };

describe('name validation', () => {
  it('accepts valid names', () => {
    expect(instanceNameSchema.safeParse('android-01').success).toBe(true);
    expect(instanceNameSchema.safeParse('game-2').success).toBe(true);
  });

  it('rejects names with unsafe characters', () => {
    expect(instanceNameSchema.safeParse('Android 01').success).toBe(false);
    expect(instanceNameSchema.safeParse('a;rm').success).toBe(false);
    expect(instanceNameSchema.safeParse('../etc/passwd').success).toBe(false);
    expect(instanceNameSchema.safeParse('').success).toBe(false);
  });
});

describe('id validation', () => {
  it('accepts generated ids', () => {
    expect(instanceIdSchema.safeParse('a1b2c3d4e5f6').success).toBe(true);
  });

  it('rejects invalid ids', () => {
    expect(instanceIdSchema.safeParse('../x').success).toBe(false);
    expect(instanceIdSchema.safeParse('abc').success).toBe(false);
    expect(instanceIdSchema.safeParse('has space').success).toBe(false);
  });
});

describe('create schema limits', () => {
  it('clamps cpu to the configured maximum', () => {
    const schema = createInstanceSchema(LIMITS);
    expect(schema.safeParse({ name: 'ok', cpu_limit: 16 }).success).toBe(false);
    expect(schema.safeParse({ name: 'ok', cpu_limit: 4 }).success).toBe(true);
  });

  it('rejects negative memory', () => {
    const schema = createInstanceSchema(LIMITS);
    expect(schema.safeParse({ name: 'ok', memory_limit_mb: -1 }).success).toBe(false);
  });
});

describe('login schema', () => {
  it('accepts minimal payload', () => {
    expect(loginSchema.safeParse({ username: 'admin', password: 'secret123' }).success).toBe(true);
    expect(loginSchema.safeParse({ username: '', password: '' }).success).toBe(false);
  });
});