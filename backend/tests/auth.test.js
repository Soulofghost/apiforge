const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');

// Use in-memory SQLite for tests
process.env.SQLITE_DB_PATH = ':memory:';

const { getDatabase, closeDatabase } = require('../src/database');
const { createApiKey, validateApiKey, listApiKeys, revokeApiKey } = require('../src/services/authService');

describe('AuthService API Key Tests', () => {
  before(() => {
    getDatabase();
  });

  after(() => {
    closeDatabase();
  });

  test('should create API key with prefix and metadata', () => {
    const key = createApiKey('Billing Service Key', 'developer', 500);

    assert.ok(key.id.startsWith('key-'));
    assert.ok(key.rawKey.startsWith('ak_'));
    assert.strictEqual(key.name, 'Billing Service Key');
    assert.strictEqual(key.role, 'developer');
    assert.strictEqual(key.rateLimitOverride, 500);
  });

  test('should validate active API key and return correct user scope', () => {
    const created = createApiKey('Analytics Worker', 'admin', 2000);
    const valid = validateApiKey(created.rawKey);

    assert.ok(valid);
    assert.strictEqual(valid.id, created.id);
    assert.strictEqual(valid.role, 'admin');
    assert.strictEqual(valid.rateLimitOverride, 2000);
    assert.strictEqual(valid.isActive, true);
  });

  test('should return null for invalid or non-existent key', () => {
    const invalid = validateApiKey('ak_completely_bogus_token_123456');
    assert.strictEqual(invalid, null);

    const empty = validateApiKey('');
    assert.strictEqual(empty, null);
  });

  test('should revoke API key and reject subsequent requests', () => {
    const key = createApiKey('Ephemeral Key', 'read_only');
    assert.ok(validateApiKey(key.rawKey));

    const revoked = revokeApiKey(key.id);
    assert.strictEqual(revoked, true);

    const checkAgain = validateApiKey(key.rawKey);
    assert.strictEqual(checkAgain, null);
  });

  test('should list all registered keys without exposing raw keys', () => {
    const keys = listApiKeys();
    assert.ok(Array.isArray(keys));
    assert.ok(keys.length >= 1);

    for (const k of keys) {
      assert.strictEqual(k.rawKey, undefined);
      assert.ok(k.keyPrefix.includes('...'));
    }
  });
});
