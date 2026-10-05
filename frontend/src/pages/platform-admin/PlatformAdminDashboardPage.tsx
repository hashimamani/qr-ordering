import { useCallback, useEffect, useState } from 'react';
import { TAB_BRAND_COLOR, derivePalette } from '../../lib/brandPalette';
import { PasswordInput } from '../../components/PasswordInput';
import { useNavigate } from 'react-router-dom';
import { apiFetch, ApiError } from '../../api/client';
import type {
  RestaurantAdmin,
  RestaurantMode,
  RestaurantSignupResponse,
  RestaurantSummary,
  ResetPreview,
} from '../../api/types';
import { usePlatformAdminAuth } from '../../auth/PlatformAdminAuthContext';
import { useToast } from '../../components/ToastProvider';

const EMPTY_FORM = {
  restaurant_name: '',
  restaurant_slug: '',
  brand_color: TAB_BRAND_COLOR,
  admin_name: '',
  admin_phone_or_email: '',
  admin_password: '',
};

export function PlatformAdminDashboardPage() {
  const { session, logout } = usePlatformAdminAuth();
  const navigate = useNavigate();
  const showToast = useToast();
  const [restaurants, setRestaurants] = useState<RestaurantSummary[]>([]);
  const [loadError, setLoadError] = useState('');
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [managingRestaurantId, setManagingRestaurantId] = useState<string | null>(null);
  const [modeChangingId, setModeChangingId] = useState<string | null>(null);
  const [resetTarget, setResetTarget] = useState<ResetPreview | null>(null);
  const [confirmSlug, setConfirmSlug] = useState('');
  const [resetting, setResetting] = useState(false);
  const [admins, setAdmins] = useState<RestaurantAdmin[]>([]);
  const [resetPasswords, setResetPasswords] = useState<Record<string, string>>({});
  const [resettingId, setResettingId] = useState<string | null>(null);
  const [resetDoneId, setResetDoneId] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!session) return;
    apiFetch<{ restaurants: RestaurantSummary[] }>('/platform-admin/restaurants', { authToken: session.token })
      .then((data) => setRestaurants(data.restaurants))
      .catch((err: ApiError) => setLoadError(err.message));
  }, [session]);

  useEffect(load, [load]);

  if (!session) return null;

  function toggleManage(restaurantId: string) {
    if (managingRestaurantId === restaurantId) {
      setManagingRestaurantId(null);
      setAdmins([]);
      return;
    }
    setManagingRestaurantId(restaurantId);
    setResetDoneId(null);
    apiFetch<{ admins: RestaurantAdmin[] }>(`/platform-admin/restaurants/${restaurantId}/admins`, {
      authToken: session!.token,
    })
      .then((data) => setAdmins(data.admins))
      .catch((err: ApiError) => showToast(err.message));
  }

  async function resetPassword(staffId: string) {
    const password = resetPasswords[staffId] ?? '';
    if (password.length < 8) {
      showToast('New password needs 8+ characters.');
      return;
    }
    setResettingId(staffId);
    try {
      await apiFetch(`/platform-admin/staff/${staffId}/password`, {
        method: 'PATCH',
        authToken: session!.token,
        body: { password },
      });
      setResetPasswords((prev) => ({ ...prev, [staffId]: '' }));
      setResetDoneId(staffId);
      showToast('Password reset.', 'success');
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Something went wrong.');
    } finally {
      setResettingId(null);
    }
  }

  async function changeMode(r: RestaurantSummary, mode: RestaurantMode) {
    setModeChangingId(r.id);
    try {
      await apiFetch(`/platform-admin/restaurants/${r.id}/mode`, {
        method: 'PATCH',
        authToken: session!.token,
        body: { mode },
      });
      setRestaurants((prev) => prev.map((x) => (x.id === r.id ? { ...x, mode } : x)));
      // A panel open for this restaurant is now describing a stale mode.
      if (resetTarget?.restaurant.id === r.id) closeReset();
      showToast(`${r.name} is now in ${mode} mode.`, 'success');
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Could not change mode.', 'error');
    } finally {
      setModeChangingId(null);
    }
  }

  function closeReset() {
    setResetTarget(null);
    setConfirmSlug('');
  }

  // Loads what would actually be destroyed, so the prompt can state it
  // rather than asking "are you sure?" about an unknown quantity.
  async function openReset(r: RestaurantSummary) {
    if (resetTarget?.restaurant.id === r.id) return closeReset();
    setConfirmSlug('');
    try {
      const preview = await apiFetch<ResetPreview>(`/platform-admin/restaurants/${r.id}/reset`, {
        authToken: session!.token,
      });
      setResetTarget(preview);
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Could not load reset details.', 'error');
    }
  }

  async function confirmReset() {
    if (!resetTarget) return;
    setResetting(true);
    try {
      const { cleared } = await apiFetch<{ cleared: { orders: number; table_sessions: number } }>(
        `/platform-admin/restaurants/${resetTarget.restaurant.id}/reset`,
        { method: 'POST', authToken: session!.token, body: { confirm_slug: confirmSlug } },
      );
      showToast(`Cleared ${cleared.orders} order(s) from ${resetTarget.restaurant.name}.`, 'success');
      closeReset();
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Reset failed.', 'error');
    } finally {
      setResetting(false);
    }
  }

  async function onboardRestaurant() {
    if (
      !form.restaurant_name.trim() ||
      !form.restaurant_slug.trim() ||
      !form.admin_name.trim() ||
      !form.admin_phone_or_email.trim() ||
      form.admin_password.length < 8
    ) {
      showToast('All fields are required, and the admin password needs 8+ characters.');
      return;
    }
    setCreating(true);
    try {
      await apiFetch<RestaurantSignupResponse>('/platform-admin/restaurants', {
        method: 'POST',
        authToken: session!.token,
        body: {
          ...form,
          restaurant_name: form.restaurant_name.trim(),
          restaurant_slug: form.restaurant_slug.trim(),
          brand_color: form.brand_color,
          admin_name: form.admin_name.trim(),
          admin_phone_or_email: form.admin_phone_or_email.trim(),
        },
      });
      setForm(EMPTY_FORM);
      load();
      showToast('Restaurant onboarded.', 'success');
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Something went wrong.');
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
        {loadError && <div className="error-banner">{loadError}</div>}

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
            placeholder="e.g. seaside-bistro"
          />
          <label>Brand colour</label>
          <div className="brand-color-row">
            <input
              type="color"
              className="brand-color-input"
              value={form.brand_color}
              onChange={(e) => setForm({ ...form, brand_color: e.target.value })}
            />
            <input
              aria-label="Brand colour hex"
              value={form.brand_color}
              onChange={(e) => setForm({ ...form, brand_color: e.target.value })}
              spellCheck={false}
              maxLength={7}
            />
            <span className="brand-preview">
              {([100, 500, 700] as const).map((stop) => (
                <span
                  key={stop}
                  className="brand-swatch"
                  style={{ background: derivePalette(form.brand_color)[stop] }}
                />
              ))}
            </span>
          </div>
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
          <PasswordInput
            autoCompleteMode="new"
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

        <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Slug</th>
              <th>Mode</th>
              <th>Onboarded</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {restaurants.map((r) => (
              <tr key={r.id}>
                <td>{r.name}</td>
                <td>{r.slug}</td>
                <td>
                  <span className={`status-pill mode-${r.mode}`}>{r.mode}</span>
                </td>
                <td>{new Date(r.created_at).toLocaleDateString()}</td>
                <td className="row-actions">
                  <button className="secondary" onClick={() => toggleManage(r.id)}>
                    {managingRestaurantId === r.id ? 'Close' : 'Manage admins'}
                  </button>{' '}
                  <button
                    className="secondary"
                    disabled={modeChangingId === r.id}
                    onClick={() => changeMode(r, r.mode === 'test' ? 'live' : 'test')}
                  >
                    {modeChangingId === r.id ? '…' : r.mode === 'test' ? 'Mark live' : 'Mark test'}
                  </button>{' '}
                  {/* Only offered for test tenants. The server refuses a live
                      one regardless; hiding it here keeps the destructive
                      action out of reach rather than merely unsuccessful. */}
                  {r.mode === 'test' && (
                    <button className="danger" onClick={() => openReset(r)}>
                      {resetTarget?.restaurant.id === r.id ? 'Close' : 'Reset data'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>

        {resetTarget && (
          <div className="card danger-card">
            <h3 style={{ marginTop: 0 }}>Reset {resetTarget.restaurant.name}</h3>
            <p className="sub">
              This permanently deletes the restaurant's trading history. There is no undo and no backup
              inside the app.
            </p>
            <div className="reset-split">
              <div>
                <div className="reset-heading">Will be deleted</div>
                <ul className="reset-list">
                  <li>
                    <strong>{resetTarget.counts.orders}</strong> order(s), with their items, receipts,
                    notification log and report data
                  </li>
                  <li>
                    <strong>{resetTarget.counts.table_sessions}</strong> table session(s)
                  </li>
                </ul>
              </div>
              <div>
                <div className="reset-heading">Will be kept</div>
                <ul className="reset-list">
                  <li>Menu categories and items</li>
                  <li>Tables and their QR codes — printed codes keep working</li>
                  <li>Staff accounts and logins</li>
                </ul>
              </div>
            </div>
            <label>
              Type <code>{resetTarget.restaurant.slug}</code> to confirm
            </label>
            <input
              value={confirmSlug}
              onChange={(e) => setConfirmSlug(e.target.value)}
              placeholder={resetTarget.restaurant.slug}
              autoComplete="off"
            />
            <div style={{ marginTop: 12 }}>
              <button
                className="danger"
                disabled={resetting || confirmSlug !== resetTarget.restaurant.slug}
                onClick={confirmReset}
              >
                {resetting ? 'Resetting…' : 'Reset this restaurant'}
              </button>{' '}
              <button className="secondary" onClick={closeReset}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {managingRestaurantId && (
          <div className="card">
            <h3 style={{ marginTop: 0 }}>Reset an admin's password</h3>
            <p className="sub">
              Scoped to the admin role only -- for a restaurant admin who's locked out. Everything else about
              their account stays theirs to manage.
            </p>
            {admins.length === 0 && <div className="empty-state">No admin accounts found.</div>}
            {admins.map((a) => (
              <div key={a.id} className="item-row">
                <div>
                  <div className="item-name">{a.name}</div>
                  <div className="item-desc">{a.phone_or_email}</div>
                </div>
                <div>
                  <PasswordInput
                    autoCompleteMode="new"
                    placeholder="New password (8+ chars)"
                    value={resetPasswords[a.id] ?? ''}
                    onChange={(e) => setResetPasswords((prev) => ({ ...prev, [a.id]: e.target.value }))}
                  />{' '}
                  <button className="primary" disabled={resettingId === a.id} onClick={() => resetPassword(a.id)}>
                    {resettingId === a.id ? 'Resetting…' : resetDoneId === a.id ? 'Reset ✓' : 'Reset password'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </>
  );
}
