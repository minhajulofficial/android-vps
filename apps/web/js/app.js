/* Android VPS dashboard — vanilla JS, no framework, no build step. */
(function () {
  'use strict';

  const TOKEN_KEY = 'avps_token';
  const $ = (sel) => document.querySelector(sel);

  let token = localStorage.getItem(TOKEN_KEY) || '';
  let currentUser = null;
  let instances = [];

  /* ------------------------------------------------------------------ api */
  async function api(method, url, body) {
    const res = await fetch(url, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {})
      },
      body: body ? JSON.stringify(body) : undefined
    });
    let payload;
    try { payload = await res.json(); } catch { payload = { success: false, error: { code: 'HTTP_' + res.status, message: res.statusText } }; }
    if (res.status === 401 && url !== '/api/auth/login') {
      logout();
      throw new Error('Session expired — please sign in again');
    }
    if (!payload.success) throw new Error((payload.error && payload.error.message) || 'Request failed');
    return payload.data;
  }

  /* ------------------------------------------------------------------ auth */
  function sessionState() {
    return { has: Boolean(token) };
  }
  function showLogin() {
    $('#login-view').classList.remove('hidden');
    $('#app-view').classList.add('hidden');
  }
  function showApp() {
    $('#login-view').classList.add('hidden');
    $('#app-view').classList.remove('hidden');
    $('#user-label').textContent = currentUser ? `${currentUser.username} (${currentUser.role})` : '';
    if (!currentUser || currentUser.role !== 'admin') {
      $('#new-instance-btn').classList.add('hidden');
      $('#create-form-wrap').classList.add('hidden');
    } else {
      $('#new-instance-btn').classList.remove('hidden');
    }
  }
  async function verifySession() {
    if (!sessionState().has) { showLogin(); return false; }
    try {
      const res = await api('post', '/api/auth/verify', { token });
      if (!res.valid) { logout(); return false; }
      currentUser = res.user;
      showApp();
      return true;
    } catch {
      logout();
      return false;
    }
  }
  function logout() {
    token = '';
    currentUser = null;
    localStorage.removeItem(TOKEN_KEY);
    showLogin();
  }

  /* ------------------------------------------------------------------ overview */
  async function refreshStats() {
    if (!sessionState().has) return;
    try {
      const [health, stats] = await Promise.all([
        api('get', '/api/health'),
        api('get', '/api/server/stats')
      ]);
      $('#stat-status').textContent = health.status.toUpperCase();
      $('#stat-status').className = 'stat ' + (health.status === 'healthy' ? 'good' : 'warn');
      $('#drv-pill').textContent = health.runtime.driver + ' · ' + (health.runtime.driverLabel || '');
      $('#runtime-detail').textContent =
        `${health.runtime.driverLabel || health.runtime.driver}\nreason: ${health.runtime.reason}\n` +
        `capabilities: ${JSON.stringify(health.runtime.capabilities, null, 2)}\n` +
        `future drivers: ${health.runtime.futureDrivers ? health.runtime.futureDrivers.map((d) => d.id).join(', ') : 'none'}`;

      $('#stat-cpu').textContent = stats.cpus.usagePercent + '%';
      $('#stat-ram').textContent = `${stats.memory.usedPercent}%  (${stats.memory.usedMb} / ${stats.memory.totalMb} MB)`;
      $('#stat-disk').textContent = `${stats.disk.usedPercent}%  (${stats.disk.usedGb} / ${stats.disk.totalGb} GB)`;
      $('#stat-total').textContent = stats.instances.total;
      $('#stat-running').textContent = stats.instances.running;
      $('#stat-stopped').textContent = stats.instances.stopped;
      $('#stat-uptime').textContent = fmtUptime(stats.uptimeSeconds);
    } catch (e) {
      $('#stat-status').textContent = 'OFFLINE';
      $('#stat-status').className = 'stat bad';
    }
  }

  function fmtUptime(sec) {
    const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
    return d ? `${d}d ${h}h ${m}m` : `${h}h ${m}m`;
  }

  /* ------------------------------------------------------------------ instances */
  async function refreshInstances() {
    if (!sessionState().has) return;
    try {
      instances = await api('get', '/api/instances');
    } catch { instances = []; }
    renderInstances();
  }

  function statusClass(s) { return s === 'running' ? 'run' : s === 'error' ? 'err' : 'stop'; }

  function renderInstances() {
    const list = $('#instances-list');
    const empty = $('#instances-empty');
    if (!instances.length) {
      list.innerHTML = '';
      empty.classList.remove('hidden');
      return;
    }
    empty.classList.add('hidden');
    list.innerHTML = instances.map(renderInstanceCard).join('\n');
    list.querySelectorAll('button[data-action]').forEach((btn) => {
      btn.addEventListener('click', () => onAction(btn.dataset.action, btn.dataset.id, btn));
    });
  }

  function renderInstanceCard(i) {
    const live = i.liveStatus && i.liveStatus.kind === 'running';
    const canDelete = currentUser && currentUser.role === 'admin';
    return `
      <div class="instance" id="inst-${i.id}">
        <h3>${esc(i.name)} <span class="pill ${statusClass(i.status)}">${i.status}</span></h3>
        <div class="kv">
          <span>Status</span><b>${i.status}</b>
          <span>ID</span><b class="mono">${i.id}</b>
          <span>Android</span><b>${esc(i.android_version) || '—'}</b>
          <span>CPU</span><b>${i.cpu_limit} vCPU</b>
          <span>RAM</span><b>${i.memory_limit_mb} MB</b>
          <span>Storage</span><b>${i.storage_limit_gb} GB</b>
          <span>VNC</span><b>${live ? i.vnc_port : '127.0.0.1:' + (i.vnc_port || '—')}${live ? ' (live)' : ''}</b>
          ${i.error_message ? `<span>Error</span><b class="bad">${esc(i.error_message)}</b>` : ''}
        </div>
        <div class="actions">
          <button class="btn primary" data-action="open" data-id="${i.id}" ${i.status !== 'running' ? 'disabled' : ''}>Open Android</button>
          <button class="btn" data-action="start" data-id="${i.id}" ${i.status === 'running' ? 'disabled' : ''}>Start</button>
          <button class="btn" data-action="restart" data-id="${i.id}" ${i.status !== 'running' ? 'disabled' : ''}>Restart</button>
          <button class="btn" data-action="stop" data-id="${i.id}" ${i.status === 'stopped' ? 'disabled' : ''}>Stop</button>
          <button class="btn" data-action="logs" data-id="${i.id}">Logs</button>
          ${canDelete ? `<button class="btn danger" data-action="delete" data-id="${i.id}">Delete</button>` : ''}
        </div>
      </div>`;
  }

  async function onAction(action, id, btn) {
    try {
      if (action === 'open') {
        window.open(`/instance/${id}`, '_blank');
        return;
      }
      if (action === 'logs') {
        const data = await api('get', `/api/instances/${id}/logs?lines=400`);
        $('#logs-title').textContent = `Logs — ${id}`;
        $('#logs-body').textContent = data.lines || '(empty)';
        $('#logs-modal').classList.remove('hidden');
        return;
      }
      if (action === 'delete' && !confirm('Destroy this instance permanently?')) return;
      btn.disabled = true;
      const label = btn.textContent;
      btn.textContent = '…';
      try {
        if (action === 'start') await api('post', `/api/instances/${id}/start`);
        if (action === 'stop') await api('post', `/api/instances/${id}/stop`);
        if (action === 'restart') await api('post', `/api/instances/${id}/restart`);
        if (action === 'delete') await api('delete', `/api/instances/${id}`);
      } finally {
        btn.textContent = label;
        btn.disabled = false;
      }
      await refreshInstances();
      refreshStats();
    } catch (e) {
      alert(e.message);
    }
  }

  /* ------------------------------------------------------------------ create */
  function showCreate() {
    $('#create-form-wrap').classList.remove('hidden');
  }
  function hideCreate() {
    $('#create-form-wrap').classList.add('hidden');
  }
  async function submitCreate(e) {
    e.preventDefault();
    const body = {
      name: $('#cf-name').value.trim(),
      cpu_limit: Number($('#cf-cpu').value) || undefined,
      memory_limit_mb: Number($('#cf-mem').value) || undefined,
      storage_limit_gb: Number($('#cf-disk').value) || undefined,
      driver: $('#cf-driver').value || undefined
    };
    try {
      await api('post', '/api/instances', body);
      $('#cf-name').value = '';
      hideCreate();
      await refreshInstances();
      refreshStats();
    } catch (err) {
      alert(err.message);
    }
  }

  /* ------------------------------------------------------------------ tabs */
  function switchTab(name) {
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.toggle('hidden', p.id !== 'tab-' + name));
  }

  /* ------------------------------------------------------------------ boot */
  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  async function boot() {
    $('#login-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const username = $('#login-username').value.trim();
      const password = $('#login-password').value;
      try {
        const data = await api('post', '/api/auth/login', { username, password });
        token = data.token;
        localStorage.setItem(TOKEN_KEY, token);
        currentUser = data.user;
        $('#login-error').classList.add('hidden');
        showApp();
        init();
      } catch (err) {
        $('#login-error').textContent = err.message;
        $('#login-error').classList.remove('hidden');
      }
    });

    $('#logout-btn').addEventListener('click', logout);
    $('#new-instance-btn').addEventListener('click', showCreate);
    $('#cf-cancel').addEventListener('click', hideCreate);
    $('#create-form').addEventListener('submit', submitCreate);
    $('#logs-close').addEventListener('click', () => $('#logs-modal').classList.add('hidden'));
    document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => switchTab(t.dataset.tab)));

    const authed = await verifySession();
    if (authed) init();
  }

  let pollTimer = null;
  function init() {
    switchTab('overview');
    refreshStats();
    refreshInstances();
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(() => {
      refreshStats();
      refreshInstances();
    }, 5000);
  }

  boot();
})();