import { describe, expect, it } from 'vitest';
import { RateLimiter } from '../../src/security/rate-limit.js';

describe('RateLimiter', () => {
  it('allows requests up to the maximum', () => {
    const limiter = RateLimiter.create({ windowSeconds: 60, max: 3, enabled: true });
    expect(limiter.consume('a')).toBe(true);
    expect(limiter.consume('a')).toBe(true);
    expect(limiter.consume('a')).toBe(true);
    expect(limiter.consume('a')).toBe(false);
  });

  it('is per-key', () => {
    const limiter = RateLimiter.create({ windowSeconds: 60, max: 1, enabled: true });
    expect(limiter.consume('ip-1')).toBe(true);
    expect(limiter.consume('ip-2')).toBe(true);
    expect(limiter.consume('ip-1')).toBe(false);
  });

  it('locks a key via noteFailure and recovers after the window', () => {
    const limiter = RateLimiter.create({ windowSeconds: 60, max: 10, enabled: true });
    limiter.noteFailure('user:x', 2, 1);
    limiter.noteFailure('user:x', 2, 1);
    expect(limiter.consume('user:x')).toBe(false);
    limiter.reset('user:x');
    expect(limiter.consume('user:x')).toBe(true);
  });

  it('can be disabled', () => {
    const limiter = RateLimiter.create({ windowSeconds: 60, max: 1, enabled: false });
    for (let i = 0; i < 50; i++) expect(limiter.consume('any')).toBe(true);
  });
});