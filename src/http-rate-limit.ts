export type HttpRateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
};

type Bucket = {
  windowStartedAt: number;
  hits: number;
};

export class InMemoryHttpRateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  consume(
    key: string,
    options: { windowMs: number; maxRequests: number; nowMs?: number },
  ): HttpRateLimitResult {
    const nowMs = options.nowMs ?? Date.now();
    this.prune(nowMs, options.windowMs);

    const existing = this.buckets.get(key);
    if (!existing || nowMs - existing.windowStartedAt >= options.windowMs) {
      this.buckets.set(key, { windowStartedAt: nowMs, hits: 1 });
      return {
        allowed: true,
        remaining: Math.max(options.maxRequests - 1, 0),
        retryAfterMs: 0,
      };
    }

    if (existing.hits >= options.maxRequests) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterMs: Math.max(options.windowMs - (nowMs - existing.windowStartedAt), 0),
      };
    }

    existing.hits += 1;
    return {
      allowed: true,
      remaining: Math.max(options.maxRequests - existing.hits, 0),
      retryAfterMs: 0,
    };
  }

  private prune(nowMs: number, windowMs: number): void {
    for (const [key, bucket] of this.buckets) {
      if (nowMs - bucket.windowStartedAt >= windowMs * 2) {
        this.buckets.delete(key);
      }
    }
  }
}
