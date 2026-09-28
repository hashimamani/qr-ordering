import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch, ApiError } from '../../api/client';
import type { LoginResponse, StaffRole } from '../../api/types';
import { useAuth } from '../../auth/AuthContext';
import { useToast } from '../../components/ToastProvider';
import { PasswordInput } from '../../components/PasswordInput';

const ROLE_DESTINATION: Record<StaffRole, string> = {
  admin: '/admin',
  kitchen: '/staff/kitchen',
  bar: '/staff/bar',
  waiter: '/staff/waiter',
};

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const showToast = useToast();
  // Empty, not a seeded demo slug: this page is shared by every tenant's
  // staff, so a prefilled value is wrong for all but one of them.
  const [slug, setSlug] = useState('');
  const [contact, setContact] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit() {
    setLoading(true);
    try {
      const result = await apiFetch<LoginResponse>('/staff/login', {
        method: 'POST',
        body: { restaurant_slug: slug.trim(), phone_or_email: contact.trim(), password },
      });
      login(result.token, result.name, result.restaurant_name, result.brand_color);
      navigate(ROLE_DESTINATION[result.role]);
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <header>
        <h1>Tab</h1>
        <div className="sub">Staff login</div>
      </header>
      <main className="auth">
        <div className="card">
          <label htmlFor="slug">Restaurant slug</label>
          <input
            id="slug"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder="your-restaurant"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
          <label htmlFor="contact">Phone or email</label>
          <input
            id="contact"
            value={contact}
            onChange={(e) => setContact(e.target.value)}
            placeholder="you@example.com or +2547…"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
          <label htmlFor="password">Password</label>
          <PasswordInput
            id="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button className="primary" disabled={loading} onClick={submit}>
            {loading ? 'Logging in…' : 'Log in'}
          </button>
        </div>
      </main>
    </>
  );
}
