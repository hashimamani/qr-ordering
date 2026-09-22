const params = new URLSearchParams(window.location.search);
const token = params.get('token');

const itemsEl = document.getElementById('items');
const errorEl = document.getElementById('error');

function showError(message) {
  errorEl.textContent = message;
  errorEl.style.display = 'block';
}

function render(order) {
  document.getElementById('submitted-at').textContent =
    'Placed ' + new Date(order.submitted_at).toLocaleTimeString();

  itemsEl.innerHTML = '';
  order.items.forEach((item) => {
    const row = document.createElement('div');
    row.className = 'card item-row';
    row.innerHTML =
      '<div>' +
      '<div class="item-name">' + item.quantity + '× ' + item.menu_item_name + '</div>' +
      (item.notes ? '<div class="item-desc">' + item.notes + '</div>' : '') +
      '</div>' +
      '<span class="status-pill status-' + item.status + '">' + item.status + '</span>';
    itemsEl.appendChild(row);
  });
}

async function load() {
  if (!token) {
    showError('Missing ?token= in the URL.');
    return;
  }
  try {
    const order = await apiFetch('/track/' + token);
    render(order);
  } catch (err) {
    showError(err.message);
    return;
  }

  // Live updates via WebSocket; falls back to polling if the socket
  // never connects (still correct, just less immediate).
  let sawSocket = false;
  connectRealtime(
    'order:' + token,
    null,
    () => {
      apiFetch('/track/' + token).then(render).catch(() => {});
    },
    (connected) => {
      sawSocket = true;
      document.getElementById('conn-dot').classList.toggle('live', connected);
      document.getElementById('conn-text').textContent = connected ? 'live' : 'reconnecting…';
    },
  );

  setInterval(() => {
    if (!sawSocket) {
      apiFetch('/track/' + token).then(render).catch(() => {});
    }
  }, 5000);
}

load();
