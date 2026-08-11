/* VNC console — loads the noVNC client and connects it to the API's
   authenticated WebSocket proxy (/novnc/ws). */
(function () {
  'use strict';
  const TOKEN_KEY = 'avps_token';
  const token = localStorage.getItem(TOKEN_KEY) || '';
  const match = window.location.pathname.match(/^\/instance\/([^/]+)/);
  const instanceId = match ? match[1] : new URLSearchParams(window.location.search).get('instance');

  const stateEl = document.getElementById('console-state');
  const titleEl = document.getElementById('console-title');

  function setState(text, cls) {
    stateEl.textContent = text;
    stateEl.className = 'pill ' + (cls || '');
  }

  if (!instanceId) {
    setState('missing instance', 'err');
    titleEl.textContent = 'No instance id';
    return;
  }
  titleEl.textContent = 'Android console — ' + instanceId;
  setState('loading');

  if (!token) {
    setState('sign in first', 'err');
    window.location.href = '/';
    return;
  }

  // noVNC is fetched at deploy time into /vnc (see scripts/fetch-novnc.sh).
  // We hand it the WebSocket path including instance + token params.
  const vncPath = 'novnc/ws?instance=' + encodeURIComponent(instanceId) + '&token=' + encodeURIComponent(token);
  const iframe = document.getElementById('console-frame');
  const loading = document.getElementById('console-loading');

  iframe.src =
    '/vnc/vnc.html?autoconnect=true&reconnect=true&resize=scale&path=' + encodeURIComponent(vncPath);
  iframe.classList.remove('hidden');
  loading.classList.add('hidden');
  setState('loading display…', 'warn');

  window.addEventListener('message', (e) => {
    if (e.data && typeof e.data === 'string' && e.data.indexOf('novnc') === 0) {
      const st = e.data.split(':')[1];
      if (st === 'connecting') setState('connecting…', 'warn');
      else if (st === 'connected') setState('connected', 'run');
      else if (st === 'disconnected') setState('disconnected', 'stop');
      else if (st === 'failed') setState('connection failed', 'err');
    }
  });
})();