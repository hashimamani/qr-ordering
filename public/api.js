// Tiny shared helpers -- no build step, plain browser JS.

async function apiFetch(url, options = {}) {
  const token = localStorage.getItem('staffToken');
  const headers = Object.assign({}, options.headers);
  if (options.body) headers['Content-Type'] = 'application/json';
  if (token) headers['Authorization'] = 'Bearer ' + token;

  const res = await fetch(url, Object.assign({}, options, { headers }));
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const message = (data && data.error && data.error.message) || res.statusText;
    const err = new Error(message);
    err.status = res.status;
    throw err;
  }
  return data;
}

function decodeJwtPayload(token) {
  const payload = token.split('.')[1];
  return JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
}

function getStaffSession() {
  const token = localStorage.getItem('staffToken');
  if (!token) return null;
  try {
    const payload = decodeJwtPayload(token);
    return { token, restaurantId: payload.restaurantId, role: payload.role };
  } catch {
    return null;
  }
}

function requireStaffSession(allowedRoles) {
  const session = getStaffSession();
  if (!session || (allowedRoles && !allowedRoles.includes(session.role))) {
    window.location.href = '/app/staff/login.html';
    return null;
  }
  return session;
}

// Connects to /realtime, joins `room` (with `token` if given), and calls
// onEvent for every message after the initial join ack. Auto-reconnects
// with backoff; callers don't need to think about the socket lifecycle,
// just what to do when something changes.
function connectRealtime(room, token, onEvent, onStatusChange) {
  let socket;
  let attempt = 0;

  function connect() {
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    socket = new WebSocket(proto + '://' + window.location.host + '/realtime');

    socket.onopen = () => {
      attempt = 0;
      socket.send(JSON.stringify({ type: 'join', room, token }));
    };
    socket.onmessage = (msg) => {
      const event = JSON.parse(msg.data);
      if (event.type === 'joined') {
        if (onStatusChange) onStatusChange(true);
        return;
      }
      if (event.type === 'error') {
        console.warn('realtime error:', event.message);
        return;
      }
      onEvent(event);
    };
    socket.onclose = () => {
      if (onStatusChange) onStatusChange(false);
      attempt += 1;
      setTimeout(connect, Math.min(1000 * attempt, 10000));
    };
    socket.onerror = () => socket.close();
  }

  connect();
}
