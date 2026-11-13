const crypto = require('node:crypto');
const { getDatabase } = require('../database');

/**
 * Generate a new cryptographically secure API key
 * @param {string} name
 * @param {string} role - 'admin' | 'developer' | 'read_only'
 * @param {number|null} rateLimitOverride
 * @returns {{ id: string, rawKey: string, keyPrefix: string, name: string, role: string, createdAt: string }}
 */
function createApiKey(name, role = 'developer', rateLimitOverride = null) {
  const db = getDatabase();
  const id = 'key-' + crypto.randomUUID().slice(0, 8);
  const rawToken = crypto.randomBytes(20).toString('hex');
  const rawKey = `ak_${rawToken}`;
  const keyPrefix = `${rawKey.slice(0, 7)}...${rawKey.slice(-4)}`;
  const keyHash = hashKey(rawKey);
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO api_keys (id, key_hash, key_prefix, name, role, rate_limit_override, is_active, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, keyHash, keyPrefix, name.trim(), role, rateLimitOverride, 1, now);

  return {
    id,
    rawKey,
    keyPrefix,
    name: name.trim(),
    role,
    rateLimitOverride,
    createdAt: now
  };
}

/**
 * Hash raw API key using SHA-256
 */
function hashKey(rawKey) {
  return crypto.createHash('sha256').update(rawKey).digest('hex');
}

/**
 * Validate an API key from request header
 * Supports direct key or hashed lookup
 * @param {string} rawKey
 * @returns {object|null}
 */
function validateApiKey(rawKey) {
  if (!rawKey || typeof rawKey !== 'string') return null;

  const db = getDatabase();
  const trimmed = rawKey.trim();

  // Try direct match or sha256 hash match
  const hashed = hashKey(trimmed);
  const row = db.prepare(`
    SELECT * FROM api_keys 
    WHERE (key_hash = ? OR key_hash = ?) AND is_active = 1
  `).get(trimmed, hashed);

  if (!row) return null;

  // Update last used timestamp
  try {
    db.prepare('UPDATE api_keys SET last_used_at = ? WHERE id = ?').run(
      new Date().toISOString(),
      row.id
    );
  } catch (e) {
    // Non-blocking telemetry update
  }

  return {
    id: row.id,
    keyPrefix: row.key_prefix,
    name: row.name,
    role: row.role,
    rateLimitOverride: row.rate_limit_override,
    isActive: Boolean(row.is_active)
  };
}

/**
 * List all registered API keys (without revealing raw secrets)
 */
function listApiKeys() {
  const db = getDatabase();
  return db.prepare(`
    SELECT id, key_prefix, name, role, rate_limit_override, is_active, created_at, last_used_at
    FROM api_keys
    ORDER BY created_at DESC
  `).all().map(r => ({
    id: r.id,
    keyPrefix: r.key_prefix,
    name: r.name,
    role: r.role,
    rateLimitOverride: r.rate_limit_override,
    isActive: Boolean(r.is_active),
    createdAt: r.created_at,
    lastUsedAt: r.last_used_at
  }));
}

/**
 * Revoke or delete an API key
 */
function revokeApiKey(id) {
  const db = getDatabase();
  const res = db.prepare('UPDATE api_keys SET is_active = 0 WHERE id = ?').run(id);
  return res.changes > 0;
}

module.exports = {
  createApiKey,
  validateApiKey,
  listApiKeys,
  revokeApiKey,
  hashKey
};
