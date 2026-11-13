const crypto = require('node:crypto');
const { getDatabase } = require('../database');
const { createApiKey, listApiKeys, revokeApiKey } = require('../services/authService');

function handleApiRequest(reqPath, method, query, body) {
  const db = getDatabase();

  // 1. Routes CRUD
  if (reqPath === '/routes' && method === 'GET') {
    const rows = db.prepare('SELECT * FROM routes ORDER BY created_at DESC').all();
    return {
      status: 200,
      data: rows.map(r => ({
        id: r.id,
        pathPrefix: r.path_prefix,
        targetService: r.target_service,
        description: r.description,
        stripPrefix: Boolean(r.strip_prefix),
        authRequired: Boolean(r.auth_required),
        rateLimitMax: r.rate_limit_max,
        rateLimitWindowSec: r.rate_limit_window_sec,
        status: r.status,
        createdAt: r.created_at
      }))
    };
  }

  if (reqPath === '/routes' && method === 'POST') {
    if (!body || !body.pathPrefix || !body.targetService) {
      return { status: 400, data: { error: 'pathPrefix and targetService are required' } };
    }

    const id = 'route-' + crypto.randomUUID().slice(0, 8);
    let prefix = body.pathPrefix.trim();
    if (!prefix.startsWith('/')) prefix = '/' + prefix;

    const targetService = body.targetService.trim();
    const description = (body.description || '').trim();
    const stripPrefix = body.stripPrefix !== false ? 1 : 0;
    const authRequired = body.authRequired ? 1 : 0;
    const rateLimitMax = Number(body.rateLimitMax) || 60;
    const rateLimitWindowSec = Number(body.rateLimitWindowSec) || 60;
    const status = body.status === 'OFFLINE' ? 'OFFLINE' : 'ACTIVE';
    const now = new Date().toISOString();

    try {
      db.prepare(`
        INSERT INTO routes (id, path_prefix, target_service, description, strip_prefix, auth_required, rate_limit_max, rate_limit_window_sec, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, prefix, targetService, description, stripPrefix, authRequired, rateLimitMax, rateLimitWindowSec, status, now);

      return {
        status: 201,
        data: {
          id,
          pathPrefix: prefix,
          targetService,
          description,
          stripPrefix: Boolean(stripPrefix),
          authRequired: Boolean(authRequired),
          rateLimitMax,
          rateLimitWindowSec,
          status,
          createdAt: now
        }
      };
    } catch (err) {
      return { status: 409, data: { error: `Route registration failed: ${err.message}` } };
    }
  }

  // Update Route Status or Config
  if (reqPath.startsWith('/routes/') && method === 'PATCH') {
    const routeId = reqPath.replace('/routes/', '');
    const updates = [];
    const params = [];

    if (body.status) {
      updates.push('status = ?');
      params.push(body.status);
    }
    if (typeof body.authRequired === 'boolean') {
      updates.push('auth_required = ?');
      params.push(body.authRequired ? 1 : 0);
    }
    if (body.rateLimitMax) {
      updates.push('rate_limit_max = ?');
      params.push(Number(body.rateLimitMax));
    }

    if (updates.length === 0) {
      return { status: 400, data: { error: 'No fields to update' } };
    }

    params.push(routeId);
    const res = db.prepare(`UPDATE routes SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    if (res.changes === 0) {
      return { status: 404, data: { error: 'Route not found' } };
    }

    const updated = db.prepare('SELECT * FROM routes WHERE id = ?').get(routeId);
    return {
      status: 200,
      data: {
        id: updated.id,
        pathPrefix: updated.path_prefix,
        targetService: updated.target_service,
        authRequired: Boolean(updated.auth_required),
        rateLimitMax: updated.rate_limit_max,
        status: updated.status
      }
    };
  }

  // Delete Route
  if (reqPath.startsWith('/routes/') && method === 'DELETE') {
    const routeId = reqPath.replace('/routes/', '');
    const res = db.prepare('DELETE FROM routes WHERE id = ?').run(routeId);
    if (res.changes === 0) {
      return { status: 404, data: { error: 'Route not found' } };
    }
    return { status: 200, data: { success: true, message: `Route ${routeId} deleted` } };
  }

  // 2. API Keys
  if (reqPath === '/keys' && method === 'GET') {
    return { status: 200, data: listApiKeys() };
  }

  if (reqPath === '/keys' && method === 'POST') {
    const name = body?.name || 'Developer Key';
    const role = body?.role || 'developer';
    const rateLimitOverride = body?.rateLimitOverride ? Number(body.rateLimitOverride) : null;

    const newKey = createApiKey(name, role, rateLimitOverride);
    return { status: 201, data: newKey };
  }

  if (reqPath.startsWith('/keys/') && method === 'DELETE') {
    const keyId = reqPath.replace('/keys/', '');
    const revoked = revokeApiKey(keyId);
    if (!revoked) {
      return { status: 404, data: { error: 'API key not found or already inactive' } };
    }
    return { status: 200, data: { success: true, message: `Key ${keyId} revoked` } };
  }

  // 3. Telemetry & Metrics
  if (reqPath === '/metrics/summary' && method === 'GET') {
    const totalRequests = db.prepare('SELECT count(*) as cnt FROM access_logs').get().cnt;
    const ok2xx = db.prepare('SELECT count(*) as cnt FROM access_logs WHERE status_code >= 200 AND status_code < 300').get().cnt;
    const err4xx = db.prepare('SELECT count(*) as cnt FROM access_logs WHERE status_code >= 400 AND status_code < 500').get().cnt;
    const err5xx = db.prepare('SELECT count(*) as cnt FROM access_logs WHERE status_code >= 500').get().cnt;

    const avgLatRow = db.prepare('SELECT AVG(latency_ms) as avg_lat FROM access_logs').get().avg_lat;
    const avgLatency = avgLatRow ? Number(avgLatRow.toFixed(2)) : 0.0;

    const activeRoutes = db.prepare("SELECT count(*) as cnt FROM routes WHERE status = 'ACTIVE'").get().cnt;
    const activeKeys = db.prepare('SELECT count(*) as cnt FROM api_keys WHERE is_active = 1').get().cnt;

    return {
      status: 200,
      data: {
        totalRequests,
        successCount: ok2xx,
        clientErrors: err4xx,
        serverErrors: err5xx,
        successRate: totalRequests > 0 ? Number(((ok2xx / totalRequests) * 100).toFixed(1)) : 100.0,
        averageLatencyMs: avgLatency,
        activeRoutes,
        activeKeys
      }
    };
  }

  if (reqPath === '/metrics/logs' && method === 'GET') {
    const limit = Math.min(Number(query.get('limit')) || 25, 100);
    const logs = db.prepare(`
      SELECT l.*, r.path_prefix, k.name as key_name
      FROM access_logs l
      LEFT JOIN routes r ON l.route_id = r.id
      LEFT JOIN api_keys k ON l.api_key_id = k.id
      ORDER BY l.created_at DESC
      LIMIT ?
    `).all(limit);

    return {
      status: 200,
      data: logs.map(l => ({
        id: l.id,
        routeId: l.route_id,
        pathPrefix: l.path_prefix || 'Unmatched',
        clientIp: l.client_ip,
        method: l.method,
        path: l.path,
        statusCode: l.status_code,
        latencyMs: l.latency_ms,
        apiKeyId: l.api_key_id,
        keyName: l.key_name,
        createdAt: l.created_at
      }))
    };
  }

  return { status: 404, data: { error: 'Management API endpoint not found' } };
}

module.exports = {
  handleApiRequest
};
