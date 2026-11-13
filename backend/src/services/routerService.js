const crypto = require('node:crypto');
const { getDatabase } = require('../database');
const { globalRateLimiter } = require('./rateLimiter');
const { validateApiKey } = require('./authService');

/**
 * Dispatch an incoming gateway request
 * @param {object} reqDetails - { method, path, headers, clientIp, body }
 * @returns {object} { statusCode, headers, body, latencyMs, routeId }
 */
async function dispatchGatewayRequest(reqDetails) {
  const startTime = performance.now();
  const db = getDatabase();

  const { method, path: reqPath, headers = {}, clientIp = '127.0.0.1', body = null } = reqDetails;

  // 1. Strip /gateway prefix to match route path_prefix
  // e.g. /gateway/users/123 -> /users/123
  let cleanPath = reqPath;
  if (cleanPath.startsWith('/gateway')) {
    cleanPath = cleanPath.slice('/gateway'.length) || '/';
  }

  // 2. Lookup matching route
  const routes = db.prepare("SELECT * FROM routes WHERE status = 'ACTIVE' ORDER BY LENGTH(path_prefix) DESC").all();
  const route = routes.find(r => cleanPath.startsWith(r.path_prefix));

  if (!route) {
    const latencyMs = Number((performance.now() - startTime).toFixed(2));
    logAccess(null, clientIp, method, reqPath, 404, latencyMs, null);
    return {
      statusCode: 404,
      headers: { 'Content-Type': 'application/json' },
      body: {
        error: 'No upstream route configured for this path',
        path: reqPath,
        code: 'ROUTE_NOT_FOUND'
      },
      latencyMs
    };
  }

  // 3. API Key Auth Evaluation
  const rawApiKey = headers['x-api-key'] || (headers['authorization']?.startsWith('Bearer ') ? headers['authorization'].slice(7) : null);
  let authUser = null;

  if (rawApiKey) {
    authUser = validateApiKey(rawApiKey);
  }

  if (route.auth_required && !authUser) {
    const latencyMs = Number((performance.now() - startTime).toFixed(2));
    logAccess(route.id, clientIp, method, reqPath, 401, latencyMs, null);
    return {
      statusCode: 401,
      headers: { 'Content-Type': 'application/json' },
      body: {
        error: 'Unauthorized. Valid x-api-key or Bearer token required for this route.',
        route: route.path_prefix,
        code: 'UNAUTHORIZED'
      },
      latencyMs
    };
  }

  // 4. Rate Limiting Check
  // Use API key limit override if user is authenticated; otherwise use route rate limit
  const limitMax = (authUser?.rateLimitOverride) ? authUser.rateLimitOverride : route.rate_limit_max;
  const limiterId = authUser ? `key:${authUser.id}:${route.id}` : `ip:${clientIp}:${route.id}`;

  const rateCheck = globalRateLimiter.consume(limiterId, limitMax, route.rate_limit_window_sec);

  const responseHeaders = {
    'Content-Type': 'application/json',
    'X-RateLimit-Limit': String(rateCheck.limit),
    'X-RateLimit-Remaining': String(rateCheck.remaining),
    'X-RateLimit-Reset': String(rateCheck.resetSec),
    'X-Gateway-Route': route.id,
    'X-Upstream-Service': route.target_service
  };

  if (!rateCheck.allowed) {
    const latencyMs = Number((performance.now() - startTime).toFixed(2));
    logAccess(route.id, clientIp, method, reqPath, 429, latencyMs, authUser?.id || null);
    return {
      statusCode: 429,
      headers: responseHeaders,
      body: {
        error: 'Too Many Requests — Rate limit exceeded',
        limit: rateCheck.limit,
        resetInSeconds: rateCheck.resetSec,
        code: 'RATE_LIMIT_EXCEEDED'
      },
      latencyMs
    };
  }

  // 5. Forward to Upstream Service (Simulated Microservice Handler)
  const subPath = route.strip_prefix ? cleanPath.slice(route.path_prefix.length) || '/' : cleanPath;
  const upstreamResponse = handleUpstreamMock(route.target_service, method, subPath, body, headers, clientIp);

  const latencyMs = Number((performance.now() - startTime).toFixed(2));

  // 6. Record Access Log
  logAccess(route.id, clientIp, method, reqPath, upstreamResponse.statusCode, latencyMs, authUser?.id || null);

  return {
    statusCode: upstreamResponse.statusCode,
    headers: { ...responseHeaders, ...upstreamResponse.headers },
    body: upstreamResponse.data,
    latencyMs
  };
}

/**
 * Built-in mock upstream microservice dispatcher
 */
function handleUpstreamMock(serviceName, method, subPath, body, headers, clientIp) {
  switch (serviceName) {
    case 'svc_users':
      if (subPath.startsWith('/profile') || subPath === '/' || subPath === '') {
        return {
          statusCode: 200,
          headers: {},
          data: {
            service: 'svc_users',
            endpoint: subPath,
            users: [
              { id: 'usr-001', name: 'Alvin MS', email: 'alvin@example.com', role: 'Staff Architect' },
              { id: 'usr-002', name: 'Elena Rostova', email: 'elena@example.com', role: 'Security Lead' },
              { id: 'usr-003', name: 'Marcus Chen', email: 'marcus@example.com', role: 'Data Engineer' }
            ],
            timestamp: new Date().toISOString()
          }
        };
      }
      return {
        statusCode: 200,
        headers: {},
        data: {
          service: 'svc_users',
          endpoint: subPath,
          message: 'User record fetched successfully',
          id: subPath.replace('/', '')
        }
      };

    case 'svc_payments':
      return {
        statusCode: 200,
        headers: {},
        data: {
          service: 'svc_payments',
          method,
          transaction_status: 'SETTLED',
          ledger: {
            account: 'ACC-8849-CORP',
            balance_usd: 142500.50,
            currency: 'USD',
            verified: true
          },
          timestamp: new Date().toISOString()
        }
      };

    case 'svc_analytics':
      return {
        statusCode: 202,
        headers: {},
        data: {
          service: 'svc_analytics',
          status: 'INGESTED',
          events_buffered: 42,
          batch_id: 'batch-' + crypto.randomUUID().slice(0, 8),
          timestamp: new Date().toISOString()
        }
      };

    case 'svc_echo':
    default:
      return {
        statusCode: 200,
        headers: {},
        data: {
          echo: true,
          service: serviceName,
          method,
          path: subPath,
          clientIp,
          receivedHeaders: {
            host: headers.host,
            'user-agent': headers['user-agent'],
            'x-api-key': headers['x-api-key'] ? '***present***' : undefined
          },
          payload: body,
          serverTimestamp: new Date().toISOString()
        }
      };
  }
}

/**
 * Log access record to database
 */
function logAccess(routeId, clientIp, method, reqPath, statusCode, latencyMs, apiKeyId) {
  try {
    const db = getDatabase();
    const id = 'log-' + crypto.randomUUID().slice(0, 8);
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO access_logs (id, route_id, client_ip, method, path, status_code, latency_ms, api_key_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, routeId, clientIp, method, reqPath, statusCode, latencyMs, apiKeyId, now);
  } catch (err) {
    console.error('Failed to write access log:', err.message);
  }
}

module.exports = {
  dispatchGatewayRequest,
  logAccess
};
