import { useCallback, useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { apiFetch, ApiError } from '../../api/client';
import type { AdminTable, CreatedTableWithQr, StaffUserSummary } from '../../api/types';
import { Dialog } from '../../components/Dialog';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { RowMenu } from '../../components/RowMenu';
import { useToast } from '../../components/ToastProvider';
import { QrCodeIcon, TrashIcon, UsersIcon } from '../../components/icons';

// The frontend's own origin is the customer ordering base -- this static
// build is what the QR code needs to point at, not the API's domain.
function orderingUrlFor(slug: string, qrToken: string): string {
  return `${window.location.origin}/order?slug=${slug}&t=${qrToken}`;
}

export function AdminTablesTab() {
  const showToast = useToast();
  const [tables, setTables] = useState<AdminTable[]>([]);
  const [restaurantSlug, setRestaurantSlug] = useState('');
  const [loadError, setLoadError] = useState('');
  const [newTableNumber, setNewTableNumber] = useState('');
  const [creating, setCreating] = useState(false);
  const [justCreated, setJustCreated] = useState<CreatedTableWithQr | null>(null);
  const [qrPreviews, setQrPreviews] = useState<Record<string, string>>({});
  const [zoomTable, setZoomTable] = useState<AdminTable | null>(null);
  const [zoomQrUrl, setZoomQrUrl] = useState('');
  const [waiters, setWaiters] = useState<StaffUserSummary[]>([]);
  const [reassignTarget, setReassignTarget] = useState<AdminTable | null>(null);
  const [reassignChoice, setReassignChoice] = useState('');
  const [reassigning, setReassigning] = useState(false);
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null);
  const [confirmRegenerate, setConfirmRegenerate] = useState<AdminTable | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<AdminTable | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);

  const load = useCallback(() => {
    apiFetch<{ tables: AdminTable[]; restaurant_slug: string }>('/admin/tables', { auth: true })
      .then((data) => {
        setTables(data.tables);
        setRestaurantSlug(data.restaurant_slug);
      })
      .catch((err: ApiError) => setLoadError(err.message));
    apiFetch<{ staff: StaffUserSummary[] }>('/admin/staff', { auth: true })
      .then((data) => setWaiters(data.staff.filter((s) => s.role === 'waiter')))
      .catch(() => {});
  }, []);

  useEffect(load, [load]);

  function openReassign(table: AdminTable) {
    setReassignTarget(table);
    setReassignChoice('');
  }

  async function doReassign() {
    if (!reassignTarget || !reassignChoice) return;
    setReassigning(true);
    try {
      await apiFetch(`/admin/tables/${reassignTarget.id}`, {
        method: 'PATCH',
        auth: true,
        body: { assigned_waiter_id: reassignChoice },
      });
      setReassignTarget(null);
      load();
      showToast('Table reassigned.', 'success');
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Something went wrong.');
    } finally {
      setReassigning(false);
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

  useEffect(() => {
    if (!zoomTable || !restaurantSlug) {
      setZoomQrUrl('');
      return;
    }
    QRCode.toDataURL(orderingUrlFor(restaurantSlug, zoomTable.qr_token), { margin: 1, width: 360 })
      .then(setZoomQrUrl)
      .catch(() => {});
  }, [zoomTable, restaurantSlug]);

  async function doRegenerateQr() {
    if (!confirmRegenerate) return;
    const tableId = confirmRegenerate.id;
    setRegeneratingId(tableId);
    try {
      await apiFetch(`/admin/tables/${tableId}/regenerate-qr`, { method: 'POST', auth: true });
      setQrPreviews((prev) => {
        const next = { ...prev };
        delete next[tableId];
        return next;
      });
      setConfirmRegenerate(null);
      load();
      showToast('QR code regenerated.', 'success');
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Something went wrong.');
    } finally {
      setRegeneratingId(null);
    }
  }

  async function doRemoveTable() {
    if (!confirmRemove) return;
    setRemoveBusy(true);
    try {
      await apiFetch(`/admin/tables/${confirmRemove.id}`, { method: 'DELETE', auth: true });
      setConfirmRemove(null);
      load();
      showToast('Table removed.', 'success');
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Something went wrong.');
    } finally {
      setRemoveBusy(false);
    }
  }

  async function createTable() {
    if (!newTableNumber.trim()) return;
    setCreating(true);
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
      showToast(err instanceof ApiError ? err.message : 'Something went wrong.');
    } finally {
      setCreating(false);
    }
  }

  return (
    <div>
      {loadError && <div className="error-banner">{loadError}</div>}

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
        {tables.length === 0 && <div className="empty-state">No tables yet.</div>}
        {tables.map((table) => (
          <div key={table.id} className="card table-card">
            {qrPreviews[table.id] && (
              <button
                type="button"
                className="qr-thumb-button"
                onClick={() => setZoomTable(table)}
                aria-label={`Show larger QR code for table ${table.table_number}`}
              >
                <img className="qr-preview" style={{ width: 72, height: 72 }} src={qrPreviews[table.id]} alt="" />
              </button>
            )}
            <div className="table-card-body">
              <div className="top-bar">
                <div className="item-name">Table {table.table_number}</div>
                <RowMenu
                  label={`Actions for table ${table.table_number}`}
                  actions={[
                    {
                      label: 'Reassign',
                      icon: <UsersIcon size={16} />,
                      onSelect: () => openReassign(table),
                    },
                    {
                      label: 'Regenerate QR',
                      icon: <QrCodeIcon size={16} />,
                      onSelect: () => setConfirmRegenerate(table),
                    },
                    {
                      label: 'Remove table',
                      icon: <TrashIcon size={16} />,
                      danger: true,
                      onSelect: () => setConfirmRemove(table),
                    },
                  ]}
                />
              </div>
              <div className="item-desc">
                {table.assigned_waiter_name ? `Assigned to ${table.assigned_waiter_name}` : 'Unassigned'}
              </div>
            </div>
          </div>
        ))}
      </div>

      <Dialog
        open={!!zoomTable}
        onClose={() => setZoomTable(null)}
        title={`Table ${zoomTable?.table_number ?? ''}`}
      >
        <div className="qr-zoom-wrap">
          {zoomQrUrl && <img className="qr-zoom-image" src={zoomQrUrl} alt="Table QR code" />}
        </div>
      </Dialog>

      <Dialog
        open={!!reassignTarget}
        onClose={() => setReassignTarget(null)}
        title={`Reassign Table ${reassignTarget?.table_number ?? ''}`}
        footer={
          <>
            <button className="secondary" onClick={() => setReassignTarget(null)}>
              Cancel
            </button>
            <button className="primary" disabled={!reassignChoice || reassigning} onClick={doReassign}>
              {reassigning ? 'Reassigning…' : 'Reassign'}
            </button>
          </>
        }
      >
        <label>Waiter</label>
        <select value={reassignChoice} onChange={(e) => setReassignChoice(e.target.value)}>
          <option value="">Select a waiter…</option>
          {waiters
            .filter((w) => w.id !== reassignTarget?.assigned_waiter_id)
            .map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
        </select>
      </Dialog>

      <ConfirmDialog
        open={!!confirmRegenerate}
        title="Regenerate QR code"
        message={`Regenerate the QR code for Table ${confirmRegenerate?.table_number}? The current printed code will stop working immediately.`}
        confirmLabel="Regenerate"
        busy={regeneratingId === confirmRegenerate?.id}
        onConfirm={doRegenerateQr}
        onCancel={() => setConfirmRegenerate(null)}
      />

      <ConfirmDialog
        open={!!confirmRemove}
        title="Remove table"
        message={`Remove Table ${confirmRemove?.table_number}? Its QR code will stop working. This is only possible once the table's session is closed.`}
        confirmLabel="Remove"
        busy={removeBusy}
        onConfirm={doRemoveTable}
        onCancel={() => setConfirmRemove(null)}
      />
    </div>
  );
}
