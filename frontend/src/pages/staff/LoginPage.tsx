import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch, ApiError } from '../../api/client';
import type { LoginResponse, StaffRole } from '../../api/types';
import { useAuth } from '../../auth/AuthContext';

const ROLE_DESTINATION: Record<StaffRole, string> = {
  admin: '/admin',
  kitchen: '/staff/kitchen',
  bar: '/staff/bar',
  waiter: '/staff/waiter',
};

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [slug, setSlug] = useState('amani-grill');
  const [contact, setContact] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit() {
    setLoading(true);
    setError('');
    try {
      const result = await apiFetch<LoginResponse>('/staff/login', {
        method: 'POST',
        body: { restaurant_slug: slug.trim(), phone_or_email: contact.trim(), password },
      });
      login(result.token, result.name);
      navigate(ROLE_DESTINATION[result.role]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <header>
        <h1>QR Ordering</h1>
        <div className="sub">Staff login</div>
      </header>
      <main className="auth">
        {error && <div className="error-banner">{error}</div>}
        <div className="card">
          <label htmlFor="slug">Restaurant slug</label>
          <input id="slug" value={slug} onChange={(e) => setSlug(e.target.value)} />
          <label htmlFor="contact">Phone or email</label>
          <input id="contact" value={contact} onChange={(e) => setContact(e.target.value)} placeholder="kitchen@amani-grill.test" />
          <label htmlFor="password">Password</label>
          <input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <button className="primary" disabled={loading} onClick={submit}>
            {loading ? 'Logging in…' : 'Log in'}
          </button>
        </div>
      </main>
    </>
  );
}
