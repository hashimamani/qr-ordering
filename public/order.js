const params = new URLSearchParams(window.location.search);
const slug = params.get('slug');
const qrToken = params.get('t');

const cart = new Map(); // menu_item_id -> quantity

const menuEl = document.getElementById('menu');
const errorEl = document.getElementById('error');
const checkoutEl = document.getElementById('checkout');
const submitBtn = document.getElementById('submit-btn');

function showError(message) {
  errorEl.textContent = message;
  errorEl.style.display = 'block';
}

function money(price) {
  return 'KSh ' + Number(price).toFixed(0);
}

function renderMenu(data) {
  document.getElementById('restaurant-name').textContent = data.restaurant.name;
  document.getElementById('table-status').textContent =
    data.table_session_status === 'active' ? 'Table open — browse and order' : data.table_session_status;

  const itemsByCategory = new Map();
  data.menu.categories.forEach((c) => itemsByCategory.set(c.id, []));
  data.menu.items.forEach((item) => {
    if (!itemsByCategory.has(item.category_id)) itemsByCategory.set(item.category_id, []);
    itemsByCategory.get(item.category_id).push(item);
  });

  menuEl.innerHTML = '';
  data.menu.categories.forEach((category) => {
    const items = itemsByCategory.get(category.id) || [];
    if (items.length === 0) return;

    const title = document.createElement('div');
    title.className = 'category-title';
    title.textContent = category.name;
    menuEl.appendChild(title);

    items.forEach((item) => {
      const row = document.createElement('div');
      row.className = 'card item-row' + (item.is_available ? '' : ' unavailable');
      row.innerHTML =
        '<div>' +
        '<div class="item-name">' + item.name + '</div>' +
        (item.description ? '<div class="item-desc">' + item.description + '</div>' : '') +
        '<div class="item-price">' + money(item.price) + '</div>' +
        '</div>' +
        (item.is_available
          ? '<div class="qty-controls">' +
            '<button data-action="dec" data-id="' + item.id + '">-</button>' +
            '<span id="qty-' + item.id + '">0</span>' +
            '<button data-action="inc" data-id="' + item.id + '">+</button>' +
            '</div>'
          : '');
      menuEl.appendChild(row);
    });
  });

  menuEl.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const id = btn.dataset.id;
    const current = cart.get(id) || 0;
    const next = btn.dataset.action === 'inc' ? current + 1 : Math.max(0, current - 1);
    if (next === 0) cart.delete(id);
    else cart.set(id, next);
    document.getElementById('qty-' + id).textContent = next;
    updateCheckout();
  });
}

function updateCheckout() {
  const totalItems = [...cart.values()].reduce((a, b) => a + b, 0);
  checkoutEl.style.display = totalItems > 0 ? 'block' : 'none';
  submitBtn.disabled = totalItems === 0;
  submitBtn.textContent = totalItems > 0 ? 'Place order (' + totalItems + ' item' + (totalItems > 1 ? 's' : '') + ')' : 'Place order';
}

document.getElementById('submit-btn').addEventListener('click', async () => {
  const contact = document.getElementById('contact').value.trim();
  const channel = document.getElementById('channel').value;
  if (!contact) {
    showError('Enter a contact number or email so we can send your tracking link.');
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = 'Placing order…';

  try {
    const items = [...cart.entries()].map(([menu_item_id, quantity]) => ({ menu_item_id, quantity }));
    const result = await apiFetch('/r/' + slug + '/t/' + qrToken + '/orders', {
      method: 'POST',
      body: JSON.stringify({ items, contact_channel: channel, contact_value: contact }),
    });
    window.location.href = '/app/track.html?token=' + result.public_token;
  } catch (err) {
    showError(err.message);
    submitBtn.disabled = false;
    updateCheckout();
  }
});

async function load() {
  if (!slug || !qrToken) {
    showError('Missing ?slug= and ?t= in the URL -- use the link printed by `npm run seed`.');
    return;
  }
  try {
    const data = await apiFetch('/r/' + slug + '/t/' + qrToken);
    renderMenu(data);
  } catch (err) {
    showError(err.message);
  }
}

load();
