const session = requireStaffSession(['admin', 'waiter']);
const sessionsEl = document.getElementById('sessions');
const errorEl = document.getElementById('error');

function showError(message) {
  errorEl.textContent = message;
  errorEl.style.display = 'block';
  setTimeout(() => (errorEl.style.display = 'none'), 4000);
}

function render(tableSessions) {
  sessionsEl.innerHTML = '';
  if (tableSessions.length === 0) {
    sessionsEl.innerHTML = '<div class="empty-state">No active tables.</div>';
    return;
  }

  tableSessions.forEach((ts) => {
    const block = document.createElement('div');
    block.className = 'table-block';

    const heading = document.createElement('div');
    heading.className = 'top-bar';
    heading.innerHTML =
      '<h3>Table ' + ts.table_number + ' <span class="status-pill status-received">' + ts.session_status + '</span></h3>' +
      '<button class="secondary danger" data-close="' + ts.session_id + '">Close table</button>';
    block.appendChild(heading);

    // Each Order is rendered as its own block, never merged into one
    // table-level total -- orders at the same table are billed
    // independently, per the platform's core design.
    ts.orders.forEach((order) => {
      const orderBlock = document.createElement('div');
      orderBlock.className = 'card order-block';
      const header = document.createElement('div');
      header.className = 'order-block-header';
      header.innerHTML =
        'Order placed ' + new Date(order.submitted_at).toLocaleTimeString() +
        ' &middot; <a class="tracking-link" href="/app/track.html?token=' + order.public_token + '" target="_blank">tracking page</a>';
      orderBlock.appendChild(header);

      order.items.forEach((item) => {
        const row = document.createElement('div');
        row.className = 'item-row';
        row.style.marginBottom = '4px';
        row.innerHTML =
          '<span>' + item.quantity + '× ' + item.menu_item_name + '</span>' +
          '<span class="status-pill status-' + item.status + '">' + item.status + '</span>';
        orderBlock.appendChild(row);
      });
      block.appendChild(orderBlock);
    });

    sessionsEl.appendChild(block);
  });
}

sessionsEl.addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-close]');
  if (!btn) return;
  if (!confirm('Close this table? Only do this once payment has been collected.')) return;
  btn.disabled = true;
  try {
    await apiFetch('/staff/table-sessions/' + btn.dataset.close + '/close', { method: 'PATCH' });
    await load();
  } catch (err) {
    showError(err.message);
    btn.disabled = false;
  }
});

async function load() {
  try {
    const data = await apiFetch('/staff/tables');
    render(data.table_sessions);
  } catch (err) {
    showError(err.message);
  }
}

document.getElementById('staff-name').textContent = localStorage.getItem('staffName') || '';
document.getElementById('logout-btn').addEventListener('click', () => {
  localStorage.removeItem('staffToken');
  window.location.href = '/app/staff/login.html';
});

load();
connectRealtime(
  'restaurant:' + session.restaurantId + ':waiter',
  session.token,
  () => load(),
  (connected) => {
    document.getElementById('conn-dot').classList.toggle('live', connected);
    document.getElementById('conn-text').textContent = connected ? 'live' : 'reconnecting…';
  },
);
