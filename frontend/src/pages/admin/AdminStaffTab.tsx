import { useCallback, useEffect, useState } from 'react';
import { apiFetch, ApiError } from '../../api/client';
import type { StaffRole, StaffUserSummary } from '../../api/types';

export function AdminStaffTab() {
  const [staff, setStaff] = useState<StaffUserSummary[]>([]);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: '', role: 'waiter' as StaffRole, phone_or_email: '', password: '' });

  const load = useCallback(() => {
    apiFetch<{ staff: StaffUserSummary[] }>('/admin/staff', { auth: true })
      .then((data) => setStaff(data.staff))
      .catch((err: ApiError) => setError(err.message));
  }, []);

  useEffect(load, [load]);

  async function addStaff() {
    if (!form.name.trim() || !form.phone_or_email.trim() || form.password.length < 8) {
      setError('Name, contact, and an 8+ character password are all required.');
      return;
    }
    setCreating(true);
    setError('');
    try {
      await apiFetch('/admin/staff', {
        method: 'POST',
        auth: true,
        body: { ...form, name: form.name.trim(), phone_or_email: form.phone_or_email.trim() },
      });
      setForm({ name: '', role: 'waiter', phone_or_email: '', password: '' });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong.');
    } finally {
      setCreating(false);
    }
  }

  return (
    <div>
      {error && <div className="error-banner">{error}</div>}

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Add staff login</h3>
        <label>Name</label>
        <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <div className="grid-2">
          <div>
            <label>Role</label>
            <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as StaffRole })}>
              <option value="waiter">Waiter</option>
              <option value="kitchen">Kitchen</option>
              <option value="bar">Bar</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <div>
            <label>Phone or email</label>
            <input value={form.phone_or_email} onChange={(e) => setForm({ ...form, phone_or_email: e.target.value })} />
          </div>
        </div>
        <label>Password (8+ characters)</label>
        <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        <button className="primary" disabled={creating} onClick={addStaff}>
          {creating ? 'Adding…' : 'Add staff login'}
        </button>
      </div>

      <table className="data-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Role</th>
            <th>Contact</th>
            <th>Added</th>
          </tr>
        </thead>
        <tbody>
          {staff.map((s) => (
            <tr key={s.id}>
              <td>{s.name}</td>
              <td style={{ textTransform: 'capitalize' }}>{s.role}</td>
              <td>{s.phone_or_email}</td>
              <td>{new Date(s.created_at).toLocaleDateString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
