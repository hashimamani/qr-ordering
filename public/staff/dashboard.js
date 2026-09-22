// Shared by kitchen.html and bar.html -- window.DESTINATION is set inline
// on each page before this script loads.

const session = requireStaffSession(['admin', DESTINATION]);
const itemsEl = document.getElementById('items');
const errorEl = document.getElementById('error');

const NEXT_STATUS = { received: 'preparing', preparing: 'ready', ready: 'served' };
const NEXT_LABEL = { received: 'Start preparing', preparing: 'Mark ready', ready: 'Mark served' };

function showError(message) {
  errorEl.textContent = message;
  errorEl.style.display = 'block';
  setTimeout(() => (errorEl.style.display = 'none'), 4000);
}

function render(tables) {
  itemsEl.innerHTML = '';
  if (tables.length === 0) {
    itemsEl.innerHTML = '<div class="empty-state">No ' + DESTINATION + ' items waiting.</div>';
    return;
  }

  tables.forEach((table) => {
    const block = document.createElement('div');
    block.className = 'table-block';
    const heading = document.createElement('h3');
    heading.textContent = 'Table ' + table.table_number;
    block.appendChild(heading);

    table.items.forEach((item) => {
      const row = document.createElement('div');
      row.className = 'card item-row';
      const nextStatus = NEXT_STATUS[item.status];
      row.innerHTML =
        '<div>' +
        '<div class="item-name">' + item.quantity + '× ' + item.menu_item_name + '</div>' +
        (item.notes ? '<div class="item-desc">' + item.notes + '</div>' : '') +
        '<span class="status-pill status-' + item.status + '">' + item.status + '</span>' +
        '</div>' +
        (nextStatus
          ? '<button class="secondary" data-id="' + item.order_item_id + '" data-next="' + nextStatus + '">' +
            NEXT_LABEL[item.status] + '</button>'
          : '');
      block.appendChild(row);
    });
    itemsEl.appendChild(block);
  });
}

itemsEl.addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-id]');
  if (!btn) return;
  btn.disabled = true;
  try {
    await apiFetch('/staff/order-items/' + btn.dataset.id + '/status', {
      method: 'PATCH',
      body: JSON.stringify({ status: btn.dataset.next }),
    });
    await load();
  } catch (err) {
    showError(err.message);
    btn.disabled = false;
  }
});

async function load() {
  try {
    const data = await apiFetch('/staff/' + DESTINATION);
    render(data.tables);
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
  'restaurant:' + session.restaurantId + ':' + DESTINATION,
  session.token,
  () => load(),
  (connected) => {
    document.getElementById('conn-dot').classList.toggle('live', connected);
    document.getElementById('conn-text').textContent = connected ? 'live' : 'reconnecting…';
  },
);
