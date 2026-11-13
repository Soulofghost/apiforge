const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');

process.env.SQLITE_DB_PATH = ':memory:';

const { getDatabase, closeDatabase } = require('../src/database');
const { dispatchGatewayRequest } = require('../src/services/routerService');
const { handleApiRequest } = require('../src/routes/apiRoutes');
const { createApiKey } = require('../src/services/authService');
const { globalRateLimiter } = require('../src/services/rateLimiter');

describe('Gateway Dispatcher & Management API Integration', () => {
  before(() => {
    getDatabase();
    globalRateLimiter.reset();
  });

  after(() => {
    closeDatabase();
  });

  test('should route /gateway/users to simulated users microservice', async () => {
    const res = await dispatchGatewayRequest({
      method: 'GET',
      path: '/gateway/users/profile',
      headers: {},
      clientIp: '127.0.0.1'
    });

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.headers['X-Gateway-Route'], 'route-users');
    assert.strictEqual(res.headers['X-Upstream-Service'], 'svc_users');
    assert.ok(res.body.users);
    assert.strictEqual(res.body.users.length, 3);
  });

  test('should return 404 for unmapped gateway route', async () => {
    const res = await dispatchGatewayRequest({
      method: 'GET',
      path: '/gateway/non-existent-service/endpoint',
      headers: {},
      clientIp: '127.0.0.1'
    });

    assert.strictEqual(res.statusCode, 404);
    assert.strictEqual(res.body.code, 'ROUTE_NOT_FOUND');
  });

  test('should block unauthenticated requests to protected route (payments)', async () => {
    const res = await dispatchGatewayRequest({
      method: 'POST',
      path: '/gateway/payments/charge',
      headers: {},
      clientIp: '127.0.0.1'
    });

    assert.strictEqual(res.statusCode, 401);
    assert.strictEqual(res.body.code, 'UNAUTHORIZED');
  });

  test('should allow authenticated request to protected route with valid API key', async () => {
    const key = createApiKey('Payments Worker', 'developer');

    const res = await dispatchGatewayRequest({
      method: 'POST',
      path: '/gateway/payments/charge',
      headers: { 'x-api-key': key.rawKey },
      clientIp: '127.0.0.1'
    });

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.transaction_status, 'SETTLED');
    assert.ok(res.headers['X-RateLimit-Limit']);
  });

  test('should enforce rate limits on gateway endpoints', async () => {
    // route-echo has limit 120, let's create a restricted route with limit = 2
    const regRes = handleApiRequest('/routes', 'POST', new URLSearchParams(), {
      pathPrefix: '/throttle',
      targetService: 'svc_echo',
      rateLimitMax: 2,
      rateLimitWindowSec: 60
    });
    assert.strictEqual(regRes.status, 201);

    const clientIp = '192.168.1.100';

    // 1st request
    const r1 = await dispatchGatewayRequest({ method: 'GET', path: '/gateway/throttle', headers: {}, clientIp });
    assert.strictEqual(r1.statusCode, 200);

    // 2nd request
    const r2 = await dispatchGatewayRequest({ method: 'GET', path: '/gateway/throttle', headers: {}, clientIp });
    assert.strictEqual(r2.statusCode, 200);

    // 3rd request should exceed rate limit
    const r3 = await dispatchGatewayRequest({ method: 'GET', path: '/gateway/throttle', headers: {}, clientIp });
    assert.strictEqual(r3.statusCode, 429);
    assert.strictEqual(r3.body.code, 'RATE_LIMIT_EXCEEDED');
  });

  test('should return aggregated metrics summary and logs', () => {
    const metricsRes = handleApiRequest('/metrics/summary', 'GET', new URLSearchParams(), null);
    assert.strictEqual(metricsRes.status, 200);
    assert.ok(metricsRes.data.totalRequests > 0);
    assert.ok(metricsRes.data.activeRoutes >= 4);

    const logsRes = handleApiRequest('/metrics/logs', 'GET', new URLSearchParams('limit=10'), null);
    assert.strictEqual(logsRes.status, 200);
    assert.ok(Array.isArray(logsRes.data));
    assert.ok(logsRes.data.length > 0);
  });
});
