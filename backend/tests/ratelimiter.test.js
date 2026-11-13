const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert');
const { TokenBucketRateLimiter } = require('../src/services/rateLimiter');

describe('TokenBucketRateLimiter Unit Tests', () => {
  let limiter;

  beforeEach(() => {
    limiter = new TokenBucketRateLimiter();
  });

  test('should allow requests within limit', () => {
    const res1 = limiter.consume('user-1', 5, 60);
    assert.strictEqual(res1.allowed, true);
    assert.strictEqual(res1.limit, 5);
    assert.strictEqual(res1.remaining, 4);

    const res2 = limiter.consume('user-1', 5, 60);
    assert.strictEqual(res2.allowed, true);
    assert.strictEqual(res2.remaining, 3);
  });

  test('should reject requests when bucket is exhausted', () => {
    const bucketKey = 'exhaust-test';
    const limit = 3;

    // Consume all 3 tokens
    for (let i = 0; i < limit; i++) {
      const res = limiter.consume(bucketKey, limit, 60);
      assert.strictEqual(res.allowed, true);
    }

    // 4th request must be rejected
    const blocked = limiter.consume(bucketKey, limit, 60);
    assert.strictEqual(blocked.allowed, false);
    assert.strictEqual(blocked.remaining, 0);
    assert.ok(blocked.resetSec > 0);
  });

  test('should track independent buckets for different identifiers', () => {
    const resA = limiter.consume('client-A', 2, 60);
    const resB = limiter.consume('client-B', 2, 60);

    assert.strictEqual(resA.allowed, true);
    assert.strictEqual(resB.allowed, true);
    assert.strictEqual(resA.remaining, 1);
    assert.strictEqual(resB.remaining, 1);
  });

  test('should reset all buckets upon calling reset()', () => {
    limiter.consume('client-C', 1, 60);
    const blocked = limiter.consume('client-C', 1, 60);
    assert.strictEqual(blocked.allowed, false);

    limiter.reset();

    const allowedAgain = limiter.consume('client-C', 1, 60);
    assert.strictEqual(allowedAgain.allowed, true);
  });
});
