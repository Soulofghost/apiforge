// APIForge Ops Gateway Console Controller
const API_BASE = '/api/v1';

// DOM Elements
const mTotalReqs = document.getElementById('mTotalReqs');
const mSuccessRate = document.getElementById('mSuccessRate');
const mSuccessCount = document.getElementById('mSuccessCount');
const mAvgLatency = document.getElementById('mAvgLatency');
const mActiveRoutes = document.getElementById('mActiveRoutes');
const mActiveKeys = document.getElementById('mActiveKeys');

const routesTableBody = document.getElementById('routesTableBody');
const routeDrawer = document.getElementById('routeDrawer');
const newRouteForm = document.getElementById('newRouteForm');

const keysList = document.getElementById('keysList');
const keyDrawer = document.getElementById('keyDrawer');
const newKeyForm = document.getElementById('newKeyForm');

const logStream = document.getElementById('logStream');
const refreshDataBtn = document.getElementById('refreshDataBtn');

// Simulator Elements
const simMethod = document.getElementById('simMethod');
const simPath = document.getElementById('simPath');
const simApiKey = document.getElementById('simApiKey');
const simPayload = document.getElementById('simPayload');
const simSendBtn = document.getElementById('simSendBtn');
const simResStatus = document.getElementById('simResStatus');
const simResLatency = document.getElementById('simResLatency');
const simResRateHeaders = document.getElementById('simResRateHeaders');
const simResBody = document.getElementById('simResBody');

function toggleRouteModal() {
  routeDrawer.classList.toggle('hidden');
}

function toggleKeyModal() {
  keyDrawer.classList.toggle('hidden');
}

// 1. Fetch Metrics Summary
async function fetchSummary() {
  try {
    const res = await fetch(`${API_BASE}/metrics/summary`);
    if (!res.ok) throw new Error('Failed to load metrics');
    const data = await res.json();

    mTotalReqs.textContent = data.totalRequests.toLocaleString();
    mSuccessRate.textContent = `${data.successRate.toFixed(1)}%`;
    mSuccessCount.textContent = `${data.successCount.toLocaleString()} successful calls`;
    mAvgLatency.textContent = `${data.averageLatencyMs.toFixed(2)} ms`;
    mActiveRoutes.textContent = data.activeRoutes;
    mActiveKeys.textContent = data.activeKeys;
  } catch (err) {
    console.error('Error fetching summary:', err);
  }
}

// 2. Fetch Routes
async function fetchRoutes() {
  try {
    const res = await fetch(`${API_BASE}/routes`);
    if (!res.ok) throw new Error('Failed to load routes');
    const routes = await res.json();

    routesTableBody.innerHTML = routes.map(r => `
      <tr>
        <td class="font-mono text-cyan"><strong>${escapeHtml(r.pathPrefix)}</strong></td>
        <td class="font-mono text-dim">${escapeHtml(r.targetService)}</td>
        <td class="font-mono">${r.rateLimitMax} req / ${r.rateLimitWindowSec}s</td>
        <td>${r.authRequired ? '<span class="status-tag status-offline">API KEY</span>' : '<span class="status-tag status-active">PUBLIC</span>'}</td>
        <td>
          <span class="status-tag ${r.status === 'ACTIVE' ? 'status-active' : 'status-offline'}">
            ${r.status}
          </span>
        </td>
        <td>
          <div style="display:flex; gap:0.4rem;">
            <button class="btn btn-sm btn-outline" onclick="loadIntoSimulator('${escapeHtml(r.pathPrefix)}')">Test</button>
            <button class="btn btn-sm btn-secondary" onclick="toggleRouteStatus('${r.id}', '${r.status}')">
              ${r.status === 'ACTIVE' ? 'Disable' : 'Enable'}
            </button>
          </div>
        </td>
      </tr>
    `).join('');
  } catch (err) {
    console.error('Error fetching routes:', err);
  }
}

async function toggleRouteStatus(routeId, currentStatus) {
  const nextStatus = currentStatus === 'ACTIVE' ? 'OFFLINE' : 'ACTIVE';
  try {
    const res = await fetch(`${API_BASE}/routes/${routeId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: nextStatus })
    });
    if (!res.ok) throw new Error('Status update failed');
    fetchRoutes();
    fetchSummary();
  } catch (err) {
    alert(`Could not toggle route: ${err.message}`);
  }
}

function loadIntoSimulator(pathPrefix) {
  simPath.value = `/gateway${pathPrefix}`;
  window.scrollTo({ top: simSendBtn.offsetTop - 120, behavior: 'smooth' });
}

// 3. Register New Route
newRouteForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const pathPrefix = document.getElementById('routePrefix').value.trim();
  const targetService = document.getElementById('routeTarget').value.trim();
  const rateLimitMax = document.getElementById('routeLimit').value;
  const rateLimitWindowSec = document.getElementById('routeWindow').value;
  const description = document.getElementById('routeDesc').value.trim();
  const authRequired = document.getElementById('routeAuthReq').checked;
  const stripPrefix = document.getElementById('routeStripPrefix').checked;

  try {
    const res = await fetch(`${API_BASE}/routes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pathPrefix,
        targetService,
        rateLimitMax,
        rateLimitWindowSec,
        description,
        authRequired,
        stripPrefix
      })
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to create route');
    }

    newRouteForm.reset();
    toggleRouteModal();
    fetchRoutes();
    fetchSummary();
  } catch (err) {
    alert(`Error: ${err.message}`);
  }
});

// 4. Fetch API Keys
async function fetchKeys() {
  try {
    const res = await fetch(`${API_BASE}/keys`);
    if (!res.ok) throw new Error('Failed to load keys');
    const keys = await res.json();

    keysList.innerHTML = keys.map(k => `
      <div class="key-card">
        <div class="key-details">
          <span class="key-name">${escapeHtml(k.name)}</span>
          <span class="key-token font-mono">${k.keyPrefix}</span>
          <span class="key-role">ROLE: ${k.role.toUpperCase()} ${k.rateLimitOverride ? `| OVERRIDE: ${k.rateLimitOverride} req/m` : ''}</span>
        </div>
        <div>
          ${k.isActive ? 
            `<button class="btn btn-sm btn-outline text-coral" onclick="revokeKey('${k.id}')">Revoke</button>` : 
            `<span class="status-tag status-offline">REVOKED</span>`}
        </div>
      </div>
    `).join('');
  } catch (err) {
    console.error('Error fetching keys:', err);
  }
}

async function revokeKey(keyId) {
  if (!confirm('Are you sure you want to revoke this API credential?')) return;
  try {
    const res = await fetch(`${API_BASE}/keys/${keyId}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Revocation failed');
    fetchKeys();
    fetchSummary();
  } catch (err) {
    alert(`Could not revoke key: ${err.message}`);
  }
}

// Generate Key
newKeyForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('keyName').value.trim();
  const role = document.getElementById('keyRole').value;
  const rateLimitOverride = document.getElementById('keyLimitOverride').value;

  try {
    const res = await fetch(`${API_BASE}/keys`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        role,
        rateLimitOverride: rateLimitOverride ? Number(rateLimitOverride) : null
      })
    });

    if (!res.ok) throw new Error('Failed to generate key');
    const newKey = await res.json();

    newKeyForm.reset();
    toggleKeyModal();
    fetchKeys();
    fetchSummary();

    // Fill simulator with new key
    simApiKey.value = newKey.rawKey;
    alert(`API Key Created!\n\nRaw Secret Token:\n${newKey.rawKey}\n\n(Copied to Gateway Simulator field)`);
  } catch (err) {
    alert(`Error: ${err.message}`);
  }
});

// 5. Fetch Real-time Access Stream
async function fetchLogs() {
  try {
    const res = await fetch(`${API_BASE}/metrics/logs?limit=25`);
    if (!res.ok) throw new Error('Failed to load logs');
    const logs = await res.json();

    if (logs.length === 0) {
      logStream.innerHTML = '<div style="color:var(--text-dim); padding:1rem; text-align:center;">No requests dispatched yet.</div>';
      return;
    }

    logStream.innerHTML = logs.map(l => {
      const codeClass = l.statusCode >= 500 ? 'code-5xx' : l.statusCode >= 400 ? 'code-4xx' : 'code-2xx';
      return `
        <div class="log-entry">
          <div class="log-left">
            <span class="log-method">${l.method}</span>
            <span class="log-code ${codeClass}">${l.statusCode}</span>
            <span class="font-mono text-dim">${escapeHtml(l.path)}</span>
          </div>
          <div class="log-latency">
            ${l.latencyMs.toFixed(1)}ms
          </div>
        </div>
      `;
    }).join('');
  } catch (err) {
    console.error('Error fetching logs:', err);
  }
}

// 6. Interactive Simulator Dispatcher
simSendBtn.addEventListener('click', async () => {
  const method = simMethod.value;
  let path = simPath.value.trim();
  if (!path.startsWith('/')) path = '/' + path;

  const apiKey = simApiKey.value.trim();
  const rawPayload = simPayload.value.trim();

  simSendBtn.disabled = true;
  simSendBtn.textContent = 'Routing...';

  const headers = {};
  if (apiKey) {
    headers['x-api-key'] = apiKey;
  }
  if (rawPayload && (method === 'POST' || method === 'PATCH' || method === 'PUT')) {
    headers['Content-Type'] = 'application/json';
  }

  const startTime = performance.now();

  try {
    const res = await fetch(path, {
      method,
      headers,
      body: (rawPayload && method !== 'GET') ? rawPayload : undefined
    });

    const elapsed = performance.now() - startTime;
    const body = await res.json().catch(() => ({}));

    // Header extraction
    const rem = res.headers.get('x-ratelimit-remaining') || '--';
    const lim = res.headers.get('x-ratelimit-limit') || '--';
    const rst = res.headers.get('x-ratelimit-reset') || '--';

    simResStatus.textContent = `HTTP ${res.status} ${res.statusText || ''}`;
    simResStatus.className = `status-badge ${res.ok ? 'ok' : 'error'}`;
    simResLatency.textContent = `${elapsed.toFixed(1)} ms`;
    simResRateHeaders.textContent = `Remaining: ${rem} | Limit: ${lim} | Reset: ${rst}s`;
    simResBody.textContent = JSON.stringify(body, null, 2);

    // Refresh telemetry
    fetchSummary();
    fetchLogs();
  } catch (err) {
    simResStatus.textContent = 'DISPATCH FAILED';
    simResStatus.className = 'status-badge error';
    simResLatency.textContent = '0.0 ms';
    simResRateHeaders.textContent = '--';
    simResBody.textContent = `Connection Error: ${err.message}`;
  } finally {
    simSendBtn.disabled = false;
    simSendBtn.textContent = 'Dispatch Request';
  }
});

refreshDataBtn.addEventListener('click', () => {
  fetchSummary();
  fetchRoutes();
  fetchKeys();
  fetchLogs();
});

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Initial Boot
fetchSummary();
fetchRoutes();
fetchKeys();
fetchLogs();
