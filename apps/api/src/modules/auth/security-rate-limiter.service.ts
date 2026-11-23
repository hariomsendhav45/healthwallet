import { Injectable } from '@nestjs/common';
import { TooManyRequestsException } from './too-many-requests.exception';

type Bucket = { count: number; resetAt: number };

/** A small process-local guardrail. Persisted phone limits are also enforced by OtpService. */
@Injectable()
export class SecurityRateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  consume(key: string, limit: number, windowMs: number): void {
    const now = Date.now();
    if (this.buckets.size > 10_000) {
      for (const [bucketKey, bucket] of this.buckets) {
        if (bucket.resetAt <= now) this.buckets.delete(bucketKey);
      }
      while (this.buckets.size > 10_000) {
        const oldest = this.buckets.keys().next().value as string | undefined;
        if (!oldest) break;
        this.buckets.delete(oldest);
      }
    }
    const current = this.buckets.get(key);
    if (!current || current.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + windowMs });
      return;
    }
    if (current.count >= limit)
      throw new TooManyRequestsException('Too many authentication requests. Try again later.');
    current.count += 1;
  }
}
