export interface RateLimiterOptions {
  windowSeconds: number;
  max: number;
  /** Set to false to disable (tests, local dev). */
  enabled: boolean;
}

interface Bucket {
  hits: number[];
  lockUntil: number | null;
}

/**
 * Simple in-memory sliding-window rate limiter.
 * Suitable for a single-node MVP. For multi-node deployments swap this for a
 * Redis-backed limiter behind the same interface.
 */
export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private constructor(private readonly opts: RateLimiterOptions) {}

  static create(opts: RateLimiterOptions): RateLimiter {
    return new RateLimiter(opts);
  }

  private prune(key: string, now: number): Bucket {
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = { hits: [], lockUntil: null };
      this.buckets.set(key, bucket);
    }
    const cutoff = now - this.opts.windowSeconds * 1000;
    bucket.hits = bucket.hits.filter((t) => t > cutoff);
    return bucket;
  }

  /** Returns true if the request is allowed. */
  consume(key: string): boolean {
    if (!this.opts.enabled) return true;
    const now = Date.now();
    const bucket = this.prune(key, now);
    if (bucket.lockUntil !== null && now < bucket.lockUntil) return false;
    bucket.hits.push(now);
    return bucket.hits.length <= this.opts.max;
  }

  lock(key: string, seconds: number): void {
    const now = Date.now();
    const bucket = this.prune(key, now);
    bucket.lockUntil = now + seconds * 1000;
    bucket.hits = [];
  }

  /** Track a failed attempt; returns the configured lockout when exceeded. */
  noteFailure(key: string, maxAttempts: number, lockoutSeconds: number): boolean {
    const now = Date.now();
    const bucket = this.prune(key, now);
    bucket.hits.push(now);
    if (bucket.hits.length >= maxAttempts) {
      this.lock(key, lockoutSeconds);
      return true;
    }
    return false;
  }

  reset(key: string): void {
    this.buckets.delete(key);
  }
}

export function clientKey(ip: string, scope: string): string {
  return `${scope}:${ip}`;
}