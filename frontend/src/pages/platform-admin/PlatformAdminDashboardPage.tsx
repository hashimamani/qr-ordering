import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch, ApiError } from '../../api/client';
import type { RestaurantSignupResponse, RestaurantSummary } from '../../api/types';
import { usePlatformAdminAuth } from '../../auth/PlatformAdminAuthContext';

const EMPTY_FORM = {
  restaurant_name: '',
  restaurant_slug: '',
  admin_name: '',
  admin_phone_or_email: '',
  admin_password: '',
};

export function PlatformAdminDashboardPage() {
  const { session, logout } = usePlatformAdminAuth();
  const navigate = useNavigate();
  const [restaurants, setRestaurants] = useState<RestaurantSummary[]>([]);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);

  const load = useCallback(() => {
    if (!session) return;
    apiFetch<{ restaurants: RestaurantSummary[] }>('/platform-admin/restaurants', { authToken: session.token })
      .then((data) => setRestaurants(data.restaurants))
      .catch((err: ApiError) => setError(err.message));
  }, [session]);

  useEffect(load, [load]);

  if (!session) return null;

  async function onboardRestaurant() {
    if (
      !form.restaurant_name.trim() ||
      !form.restaurant_slug.trim() ||
      !form.admin_name.trim() ||
      !form.admin_phone_or_email.trim() ||
      form.admin_password.length < 8
    ) {
      setError('All fields are required, and the admin password needs 8+ characters.');
      return;
    }
    setCreating(true);
    setError('');
    try {
      await apiFetch<RestaurantSignupResponse>('/platform-admin/restaurants', {
        method: 'POST',
        authToken: session!.token,
        body: {
          ...form,
          restaurant_name: form.restaurant_name.trim(),
          restaurant_slug: form.restaurant_slug.trim(),
          admin_name: form.admin_name.trim(),
          admin_phone_or_email: form.admin_phone_or_email.trim(),
        },
      });
      setForm(EMPTY_FORM);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong.');
    } finally {
      setCreating(false);
    }
  }

  return (
    <>
      <header>
        <div className="top-bar">
          <h1>Platform admin</h1>
          <button
            className="secondary"
            onClick={() => {
              logout();
              navigate('/platform-admin/login');
            }}
          >
            Log out
          </button>
        </div>
        <div className="sub">{session.name}</div>
      </header>
      <main>
        {error && <div className="error-banner">{error}</div>}

        <div className="card">
          <h3 style={{ marginTop: 0 }}>Onboard a new restaurant</h3>
          <label>Restaurant name</label>
          <input
            value={form.restaurant_name}
            onChange={(e) => setForm({ ...form, restaurant_name: e.target.value })}
          />
          <label>Slug (lowercase, digits, hyphens)</label>
          <input
            value={form.restaurant_slug}
            onChange={(e) => setForm({ ...form, restaurant_slug: e.target.value })}
            placeholder="e.g. amani-grill"
          />
          <div className="grid-2">
            <div>
              <label>Admin name</label>
              <input value={form.admin_name} onChange={(e) => setForm({ ...form, admin_name: e.target.value })} />
            </div>
            <div>
              <label>Admin phone or email</label>
              <input
                value={form.admin_phone_or_email}
                onChange={(e) => setForm({ ...form, admin_phone_or_email: e.target.value })}
              />
            </div>
          </div>
          <label>Admin password (8+ characters)</label>
          <input
            type="password"
            value={form.admin_password}
            onChange={(e) => setForm({ ...form, admin_password: e.target.value })}
          />
          <p className="sub">
            This becomes the restaurant's own admin login -- share it with them so they can log in at
            /staff/login and set up their menu and tables themselves.
          </p>
          <button className="primary" disabled={creating} onClick={onboardRestaurant}>
            {creating ? 'Onboarding…' : 'Onboard restaurant'}
          </button>
        </div>

        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Slug</th>
              <th>Onboarded</th>
            </tr>
          </thead>
          <tbody>
            {restaurants.map((r) => (
              <tr key={r.id}>
                <td>{r.name}</td>
                <td>{r.slug}</td>
                <td>{new Date(r.created_at).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </main>
    </>
  );
}
