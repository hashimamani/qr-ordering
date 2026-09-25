import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch, ApiError } from '../../api/client';
import type { PlatformAdminLoginResponse } from '../../api/types';
import { usePlatformAdminAuth } from '../../auth/PlatformAdminAuthContext';
import { useToast } from '../../components/ToastProvider';

export function PlatformAdminLoginPage() {
  const { login } = usePlatformAdminAuth();
  const navigate = useNavigate();
  const showToast = useToast();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit() {
    setLoading(true);
    try {
      const result = await apiFetch<PlatformAdminLoginResponse>('/platform-admin/login', {
        method: 'POST',
        body: { email: email.trim(), password },
      });
      login(result.token, result.name);
      navigate('/platform-admin');
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <header>
        <h1>QR Ordering</h1>
        <div className="sub">Platform admin</div>
      </header>
      <main className="auth">
        <div className="card">
          <label htmlFor="email">Email</label>
          <input id="email" value={email} onChange={(e) => setEmail(e.target.value)} />
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
