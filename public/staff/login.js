const errorEl = document.getElementById('error');

function showError(message) {
  errorEl.textContent = message;
  errorEl.style.display = 'block';
}

const ROLE_DESTINATION = {
  kitchen: '/app/staff/kitchen.html',
  bar: '/app/staff/bar.html',
  waiter: '/app/staff/waiter.html',
  admin: '/app/staff/kitchen.html', // admins can see any dashboard; kitchen is as good a default as any
};

document.getElementById('login-btn').addEventListener('click', async () => {
  try {
    const result = await apiFetch('/staff/login', {
      method: 'POST',
      body: JSON.stringify({
        restaurant_slug: document.getElementById('slug').value.trim(),
        phone_or_email: document.getElementById('contact').value.trim(),
        password: document.getElementById('password').value,
      }),
    });
    localStorage.setItem('staffToken', result.token);
    localStorage.setItem('staffName', result.name);
    window.location.href = ROLE_DESTINATION[result.role] || '/app/staff/waiter.html';
  } catch (err) {
    showError(err.message);
  }
});
