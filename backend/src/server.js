const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { getDatabase } = require('./database');
const { dispatchGatewayRequest } = require('./services/routerService');
const { handleApiRequest } = require('./routes/apiRoutes');

const PORT = process.env.PORT || 8080;
const HOST = process.env.HOST || '0.0.0.0';
const FRONTEND_DIR = path.resolve(__dirname, '..', '..', 'frontend');

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-api-key');
}

function serveStatic(reqPath, res) {
  let filePath = path.join(FRONTEND_DIR, reqPath === '/' ? 'index.html' : reqPath);
  
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(FRONTEND_DIR, 'index.html');
  }

  const ext = path.extname(filePath);
  const mimeTypes = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.svg': 'image/svg+xml',
    '.png': 'image/png'
  };

  const contentType = mimeTypes[ext] || 'text/plain';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found');
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    }
  });
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1e6) { // 1MB limit
        req.destroy();
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      if (!body) return resolve(null);
      try {
        resolve(JSON.parse(body));
      } catch (e) {
        resolve(body);
      }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;

  // 1. Health check
  if (pathname === '/api/v1/health' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'healthy',
      service: 'APIForge Gateway',
      version: '1.0.0',
      uptime: process.uptime()
    }));
    return;
  }

  // 2. Gateway Proxy Engine: Intercepts /gateway/*
  if (pathname.startsWith('/gateway')) {
    try {
      const body = await parseBody(req);
      const clientIp = req.socket.remoteAddress || req.headers['x-forwarded-for'] || '127.0.0.1';

      const dispatchResult = await dispatchGatewayRequest({
        method: req.method,
        path: pathname,
        headers: req.headers,
        clientIp,
        body
      });

      res.writeHead(dispatchResult.statusCode, dispatchResult.headers);
      res.end(JSON.stringify(dispatchResult.body));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Gateway Internal Error', message: err.message }));
    }
    return;
  }

  // 3. Management API: /api/v1/*
  if (pathname.startsWith('/api/v1')) {
    try {
      const subPath = pathname.slice('/api/v1'.length);
      const body = await parseBody(req);
      const result = handleApiRequest(subPath, req.method, parsedUrl.searchParams, body);

      res.writeHead(result.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result.data));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'API Error', message: err.message }));
    }
    return;
  }

  // 4. Serve Frontend Assets
  serveStatic(pathname, res);
});

function startServer(port = PORT, host = HOST) {
  // Ensure DB initialized
  getDatabase();
  return new Promise((resolve) => {
    server.listen(port, host, () => {
      console.log(`APIForge Gateway running on http://${host}:${port}`);
      resolve(server);
    });
  });
}

if (require.main === module) {
  startServer();
}

module.exports = {
  server,
  startServer
};
