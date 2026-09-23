import { useCallback, useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { apiFetch, ApiError } from '../../api/client';
import type { AdminTable, CreatedTableWithQr, StaffUserSummary } from '../../api/types';

// The frontend's own origin is the customer ordering base -- this static
// build is what the QR code needs to point at, not the API's domain.
function orderingUrlFor(slug: string, qrToken: string): string {
  return `${window.location.origin}/order?slug=${slug}&t=${qrToken}`;
}

export function AdminTablesTab() {
  const [tables, setTables] = useState<AdminTable[]>([]);
  const [restaurantSlug, setRestaurantSlug] = useState('');
  const [error, setError] = useState('');
  const [newTableNumber, setNewTableNumber] = useState('');
  const [creating, setCreating] = useState(false);
  const [justCreated, setJustCreated] = useState<CreatedTableWithQr | null>(null);
  const [qrPreviews, setQrPreviews] = useState<Record<string, string>>({});
  const [waiters, setWaiters] = useState<StaffUserSummary[]>([]);
  const [reassigning, setReassigning] = useState<string | null>(null);

  const load = useCallback(() => {
    apiFetch<{ tables: AdminTable[]; restaurant_slug: string }>('/admin/tables', { auth: true })
      .then((data) => {
        setTables(data.tables);
        setRestaurantSlug(data.restaurant_slug);
      })
      .catch((err: ApiError) => setError(err.message));
    apiFetch<{ staff: StaffUserSummary[] }>('/admin/staff', { auth: true })
      .then((data) => setWaiters(data.staff.filter((s) => s.role === 'waiter')))
      .catch(() => {});
  }, []);

  useEffect(load, [load]);

  async function reassign(tableId: string, waiterId: string) {
    if (!waiterId) return;
    setReassigning(tableId);
    setError('');
    try {
      await apiFetch(`/admin/tables/${tableId}`, {
        method: 'PATCH',
        auth: true,
        body: { assigned_waiter_id: waiterId },
      });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong.');
    } finally {
      setReassigning(null);
    }
  }

  useEffect(() => {
    if (!restaurantSlug) return;
    tables.forEach((table) => {
      if (qrPreviews[table.id]) return;
      QRCode.toDataURL(orderingUrlFor(restaurantSlug, table.qr_token), { margin: 1, width: 160 })
        .then((url) => setQrPreviews((prev) => ({ ...prev, [table.id]: url })))
        .catch(() => {});
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tables, restaurantSlug]);

  async function createTable() {
    if (!newTableNumber.trim()) return;
    setCreating(true);
    setError('');
    try {
      const result = await apiFetch<CreatedTableWithQr>('/admin/tables', {
        method: 'POST',
        auth: true,
        body: { table_number: newTableNumber.trim() },
      });
      setJustCreated(result);
      setNewTableNumber('');
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
        <h3 style={{ marginTop: 0 }}>Add table</h3>
        <div className="grid-2">
          <input placeholder="Table number, e.g. 7" value={newTableNumber} onChange={(e) => setNewTableNumber(e.target.value)} />
          <button className="primary" disabled={creating} onClick={createTable}>
            {creating ? 'Creating…' : 'Create table + QR'}
          </button>
        </div>
      </div>

      {justCreated && (
        <div className="card">
          <div className="item-name">Table {justCreated.table.table_number} created</div>
          <img className="qr-preview" src={`data:image/png;base64,${justCreated.qr_code_png_base64}`} alt="Table QR code" />
          <div className="item-desc" style={{ marginTop: 8, wordBreak: 'break-all' }}>
            {justCreated.ordering_url}
          </div>
        </div>
      )}

      <div className="table-block">
        <h3>All tables</h3>
        <p className="sub">
          Tables get a waiter automatically (round robin) on their first order or call-waiter press. Reassign
          below only for a handoff mid-shift -- a waiter going home sick, etc.
        </p>
        {tables.length === 0 && <div className="empty-state">No tables yet.</div>}
        {tables.map((table) => (
          <div key={table.id} className="card item-row">
            <div>
              <div className="item-name">Table {table.table_number}</div>
              {restaurantSlug && (
                <div className="item-desc" style={{ wordBreak: 'break-all' }}>
                  {orderingUrlFor(restaurantSlug, table.qr_token)}
                </div>
              )}
              <div className="item-desc">
                {table.assigned_waiter_name ? `Assigned to ${table.assigned_waiter_name}` : 'Unassigned'}
              </div>
              <select
                value=""
                disabled={reassigning === table.id || waiters.length === 0}
                onChange={(e) => reassign(table.id, e.target.value)}
              >
                <option value="">Reassign to…</option>
                {waiters
                  .filter((w) => w.id !== table.assigned_waiter_id)
                  .map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
              </select>
            </div>
            {qrPreviews[table.id] && <img className="qr-preview" style={{ width: 80, height: 80 }} src={qrPreviews[table.id]} alt="" />}
          </div>
        ))}
      </div>
    </div>
  );
}
