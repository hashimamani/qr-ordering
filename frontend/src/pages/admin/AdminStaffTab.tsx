import { useCallback, useEffect, useState } from 'react';
import { apiFetch, ApiError } from '../../api/client';
import type { StaffRole, StaffUserSummary } from '../../api/types';
import { useAuth } from '../../auth/AuthContext';
import { Dialog } from '../../components/Dialog';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { RowMenu } from '../../components/RowMenu';
import { useToast } from '../../components/ToastProvider';
import { PencilIcon, TrashIcon } from '../../components/icons';

interface EditState {
  name: string;
  role: StaffRole;
  phone_or_email: string;
  password: string;
}

export function AdminStaffTab() {
  const { session } = useAuth();
  const showToast = useToast();
  const [staff, setStaff] = useState<StaffUserSummary[]>([]);
  const [loadError, setLoadError] = useState('');
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: '', role: 'waiter' as StaffRole, phone_or_email: '', password: '' });
  const [editing, setEditing] = useState<StaffUserSummary | null>(null);
  const [editForm, setEditForm] = useState<EditState | null>(null);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState<StaffUserSummary | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);

  const load = useCallback(() => {
    apiFetch<{ staff: StaffUserSummary[] }>('/admin/staff', { auth: true })
      .then((data) => setStaff(data.staff))
      .catch((err: ApiError) => setLoadError(err.message));
  }, []);

  useEffect(load, [load]);

  async function addStaff() {
    if (!form.name.trim() || !form.phone_or_email.trim() || form.password.length < 8) {
      showToast('Name, contact, and an 8+ character password are all required.');
      return;
    }
    setCreating(true);
    try {
      await apiFetch('/admin/staff', {
        method: 'POST',
        auth: true,
        body: { ...form, name: form.name.trim(), phone_or_email: form.phone_or_email.trim() },
      });
      setForm({ name: '', role: 'waiter', phone_or_email: '', password: '' });
      load();
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Something went wrong.');
    } finally {
      setCreating(false);
    }
  }

  function startEdit(s: StaffUserSummary) {
    setEditing(s);
    setEditForm({ name: s.name, role: s.role, phone_or_email: s.phone_or_email, password: '' });
  }

  async function saveEdit() {
    if (!editing || !editForm) return;
    if (!editForm.name.trim() || !editForm.phone_or_email.trim()) {
      showToast('Name and contact are required.');
      return;
    }
    if (editForm.password && editForm.password.length < 8) {
      showToast('A new password needs 8+ characters -- leave it blank to keep the current one.');
      return;
    }
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        name: editForm.name.trim(),
        role: editForm.role,
        phone_or_email: editForm.phone_or_email.trim(),
      };
      if (editForm.password) body.password = editForm.password;
      await apiFetch(`/admin/staff/${editing.id}`, { method: 'PATCH', auth: true, body });
      setEditing(null);
      setEditForm(null);
      load();
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Something went wrong.');
    } finally {
      setSaving(false);
    }
  }

  async function confirmRemove() {
    if (!removing) return;
    setRemoveBusy(true);
    try {
      await apiFetch(`/admin/staff/${removing.id}`, { method: 'DELETE', auth: true });
      setRemoving(null);
      load();
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Something went wrong.');
    } finally {
      setRemoveBusy(false);
    }
  }

  return (
    <div>
      {loadError && <div className="error-banner">{loadError}</div>}

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
            {staff.map((s) => (
              <tr key={s.id}>
                <td>{s.name}</td>
                <td style={{ textTransform: 'capitalize' }}>{s.role}</td>
                <td>{s.phone_or_email}</td>
                <td>{new Date(s.created_at).toLocaleDateString()}</td>
                <td>
                  <RowMenu
                    label={`Actions for ${s.name}`}
                    actions={[
                      { label: 'Edit', icon: <PencilIcon size={16} />, onSelect: () => startEdit(s) },
                      {
                        label: 'Remove',
                        icon: <TrashIcon size={16} />,
                        danger: true,
                        disabled: s.id === session?.staffId,
                        onSelect: () => setRemoving(s),
                      },
                    ]}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Dialog
        open={!!editing && !!editForm}
        onClose={() => {
          setEditing(null);
          setEditForm(null);
        }}
        title={`Edit ${editing?.name ?? ''}`}
        footer={
          <>
            <button
              className="secondary"
              onClick={() => {
                setEditing(null);
                setEditForm(null);
              }}
            >
              Cancel
            </button>
            <button className="primary" disabled={saving} onClick={saveEdit}>
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </>
        }
      >
        {editForm && (
          <div>
            <label>Name</label>
            <input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
            <div className="grid-2">
              <div>
                <label>Role</label>
                <select value={editForm.role} onChange={(e) => setEditForm({ ...editForm, role: e.target.value as StaffRole })}>
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
          </div>
        )}
      </Dialog>

      <ConfirmDialog
        open={!!removing}
        title="Remove staff login"
        message={`Remove ${removing?.name}? They will no longer be able to log in.`}
        confirmLabel="Remove"
        busy={removeBusy}
        onConfirm={confirmRemove}
        onCancel={() => setRemoving(null)}
      />
    </div>
  );
}
