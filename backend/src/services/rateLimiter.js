class TokenBucketRateLimiter {
  constructor() {
    // Map: key -> { tokens, lastRefillTime, maxTokens, refillRatePerMs }
    this.buckets = new Map();
  }

  /**
   * Consume 1 token for a given bucket identifier
   * @param {string} identifier - e.g. "route-users:127.0.0.1" or "apiKey:key-123"
   * @param {number} maxRequests - Max requests allowed in window
   * @param {number} windowSec - Window duration in seconds
   * @returns {{ allowed: boolean, limit: number, remaining: number, resetSec: number }}
   */
  consume(identifier, maxRequests = 60, windowSec = 60) {
    const now = Date.now();
    const windowMs = windowSec * 1000;
    const refillRatePerMs = maxRequests / windowMs;

    let bucket = this.buckets.get(identifier);

    if (!bucket) {
      bucket = {
        tokens: maxRequests,
        lastRefillTime: now,
        maxTokens: maxRequests,
        windowSec: windowSec
      };
      this.buckets.set(identifier, bucket);
    }

    // Refill tokens based on elapsed time
    const elapsed = now - bucket.lastRefillTime;
    if (elapsed > 0) {
      const addedTokens = elapsed * refillRatePerMs;
      bucket.tokens = Math.min(bucket.maxTokens, bucket.tokens + addedTokens);
      bucket.lastRefillTime = now;
    }

    const resetSec = Math.ceil(
      ((bucket.maxTokens - bucket.tokens) / bucket.maxTokens) * windowSec
    ) || 1;

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return {
        allowed: true,
        limit: maxRequests,
        remaining: Math.floor(bucket.tokens),
        resetSec
      };
    } else {
      return {
        allowed: false,
        limit: maxRequests,
        remaining: 0,
        resetSec
      };
    }
  }

  /**
   * Clear all active rate limit buckets (useful in tests)
   */
  reset() {
    this.buckets.clear();
  }
}

// Global singleton instance
const globalRateLimiter = new TokenBucketRateLimiter();

module.exports = {
  TokenBucketRateLimiter,
  globalRateLimiter
};
