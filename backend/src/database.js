const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');

const DB_PATH = process.env.SQLITE_DB_PATH || path.join(__dirname, '..', 'apiforge.db');

// Ensure parent dir exists if writing to disk
if (DB_PATH !== ':memory:') {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

let db = null;

function getDatabase() {
  if (!db) {
    db = new DatabaseSync(DB_PATH);
    if (DB_PATH !== ':memory:') {
      db.exec('PRAGMA journal_mode = WAL;');
      db.exec('PRAGMA synchronous = NORMAL;');
    }
    initSchema(db);
  }
  return db;
}

function initSchema(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS routes (
      id TEXT PRIMARY KEY,
      path_prefix TEXT UNIQUE NOT NULL,
      target_service TEXT NOT NULL,
      description TEXT,
      strip_prefix INTEGER NOT NULL DEFAULT 1,
      auth_required INTEGER NOT NULL DEFAULT 0,
      rate_limit_max INTEGER NOT NULL DEFAULT 60,
      rate_limit_window_sec INTEGER NOT NULL DEFAULT 60,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY,
      key_hash TEXT UNIQUE NOT NULL,
      key_prefix TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'developer',
      rate_limit_override INTEGER,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      last_used_at TEXT
    );

    CREATE TABLE IF NOT EXISTS access_logs (
      id TEXT PRIMARY KEY,
      route_id TEXT,
      client_ip TEXT NOT NULL,
      method TEXT NOT NULL,
      path TEXT NOT NULL,
      status_code INTEGER NOT NULL,
      latency_ms REAL NOT NULL,
      api_key_id TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_logs_created_at ON access_logs (created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_logs_route_id ON access_logs (route_id);
  `);

  // Seed default routes if empty
  const routeCount = database.prepare('SELECT count(*) as cnt FROM routes').get().cnt;
  if (routeCount === 0) {
    const now = new Date().toISOString();
    const insertRoute = database.prepare(`
      INSERT INTO routes (id, path_prefix, target_service, description, strip_prefix, auth_required, rate_limit_max, rate_limit_window_sec, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insertRoute.run(
      'route-users',
      '/users',
      'svc_users',
      'Identity & Customer Profile Microservice',
      1,
      0,
      100,
      60,
      'ACTIVE',
      now
    );

    insertRoute.run(
      'route-payments',
      '/payments',
      'svc_payments',
      'Financial Ledger & Transaction Gateway',
      1,
      1,
      30,
      60,
      'ACTIVE',
      now
    );

    insertRoute.run(
      'route-analytics',
      '/analytics',
      'svc_analytics',
      'Real-Time Ingestion & Event Telemetry',
      1,
      0,
      200,
      60,
      'ACTIVE',
      now
    );

    insertRoute.run(
      'route-echo',
      '/echo',
      'svc_echo',
      'Echo Diagnostics & Latency Benchmark Service',
      1,
      0,
      120,
      60,
      'ACTIVE',
      now
    );
  }

  // Seed a default developer API key if none exist
  const keyCount = database.prepare('SELECT count(*) as cnt FROM api_keys').get().cnt;
  if (keyCount === 0) {
    const now = new Date().toISOString();
    database.prepare(`
      INSERT INTO api_keys (id, key_hash, key_prefix, name, role, rate_limit_override, is_active, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'key-dev-master',
      'ak_test_master_key_8f3a2c7e1b4d',
      'ak_test_master...',
      'Default Master Developer Key',
      'admin',
      1000,
      1,
      now
    );
  }
}

function closeDatabase() {
  if (db) {
    db.close();
    db = null;
  }
}

module.exports = {
  getDatabase,
  closeDatabase,
  initSchema
};
