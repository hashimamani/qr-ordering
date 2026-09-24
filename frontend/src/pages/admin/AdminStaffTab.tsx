import { useCallback, useEffect, useState } from 'react';
import { apiFetch, ApiError } from '../../api/client';
import type { StaffRole, StaffUserSummary } from '../../api/types';
import { useAuth } from '../../auth/AuthContext';

interface EditState {
  name: string;
  role: StaffRole;
  phone_or_email: string;
  password: string;
}

export function AdminStaffTab() {
  const { session } = useAuth();
  const [staff, setStaff] = useState<StaffUserSummary[]>([]);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: '', role: 'waiter' as StaffRole, phone_or_email: '', password: '' });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<EditState | null>(null);
  const [saving, setSaving] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

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

  function startEdit(s: StaffUserSummary) {
    setEditingId(s.id);
    setEditForm({ name: s.name, role: s.role, phone_or_email: s.phone_or_email, password: '' });
    setError('');
  }

  async function saveEdit(staffId: string) {
    if (!editForm) return;
    if (!editForm.name.trim() || !editForm.phone_or_email.trim()) {
      setError('Name and contact are required.');
      return;
    }
    if (editForm.password && editForm.password.length < 8) {
      setError('A new password needs 8+ characters -- leave it blank to keep the current one.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const body: Record<string, unknown> = {
        name: editForm.name.trim(),
        role: editForm.role,
        phone_or_email: editForm.phone_or_email.trim(),
      };
      if (editForm.password) body.password = editForm.password;
      await apiFetch(`/admin/staff/${staffId}`, { method: 'PATCH', auth: true, body });
      setEditingId(null);
      setEditForm(null);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong.');
    } finally {
      setSaving(false);
    }
  }

  async function removeStaff(s: StaffUserSummary) {
    if (!confirm(`Remove ${s.name}? They will no longer be able to log in.`)) return;
    setRemovingId(s.id);
    setError('');
    try {
      await apiFetch(`/admin/staff/${s.id}`, { method: 'DELETE', auth: true });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong.');
    } finally {
      setRemovingId(null);
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

      <div className="table-scroll">
      <table className="data-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Role</th>
            <th>Contact</th>
            <th>Added</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {staff.map((s) =>
            editingId === s.id && editForm ? (
              <tr key={s.id}>
                <td colSpan={5}>
                  <div className="card" style={{ margin: '8px 0' }}>
                    <label>Name</label>
                    <input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
                    <div className="grid-2">
                      <div>
                        <label>Role</label>
                        <select
                          value={editForm.role}
                          onChange={(e) => setEditForm({ ...editForm, role: e.target.value as StaffRole })}
                        >
                          <option value="waiter">Waiter</option>
                          <option value="kitchen">Kitchen</option>
                          <option value="bar">Bar</option>
                          <option value="admin">Admin</option>
                        </select>
                      </div>
                      <div>
                        <label>Phone or email</label>
                        <input
                          value={editForm.phone_or_email}
                          onChange={(e) => setEditForm({ ...editForm, phone_or_email: e.target.value })}
                        />
                      </div>
                    </div>
                    <label>New password (leave blank to keep current)</label>
                    <input
                      type="password"
                      value={editForm.password}
                      onChange={(e) => setEditForm({ ...editForm, password: e.target.value })}
                    />
                    <button className="primary" disabled={saving} onClick={() => saveEdit(s.id)}>
                      {saving ? 'Saving…' : 'Save'}
                    </button>{' '}
                    <button
                      className="secondary"
                      onClick={() => {
                        setEditingId(null);
                        setEditForm(null);
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </td>
              </tr>
            ) : (
              <tr key={s.id}>
                <td>{s.name}</td>
                <td style={{ textTransform: 'capitalize' }}>{s.role}</td>
                <td>{s.phone_or_email}</td>
                <td>{new Date(s.created_at).toLocaleDateString()}</td>
                <td>
                  <button className="secondary" onClick={() => startEdit(s)}>
                    Edit
                  </button>{' '}
                  <button
                    className="secondary danger"
                    disabled={s.id === session?.staffId || removingId === s.id}
                    onClick={() => removeStaff(s)}
                  >
                    {removingId === s.id ? 'Removing…' : 'Remove'}
                  </button>
                </td>
              </tr>
            ),
          )}
        </tbody>
      </table>
      </div>
    </div>
  );
}
