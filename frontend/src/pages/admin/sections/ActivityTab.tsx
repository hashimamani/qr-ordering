import { useCallback, useEffect, useState } from 'react';
import { apiFetch, ApiError } from '../../../api/client';
import type { ActivityEntry, OrderItemStatus } from '../../../api/types';
import { ShieldAlertIcon } from '../../../components/icons';

const STATUS_LABEL: Record<OrderItemStatus, string> = {
  received: 'Pending',
  preparing: 'Preparing',
  ready: 'Ready',
  served: 'Served',
  cancelled: 'Cancelled',
};

/**
 * The audit trail, surfaced. Every status transition is recorded (not
 * just overrides), so this doubles as a plain activity feed for the
 * whole floor -- the override filter is what answers "who reached over
 * a station, and why".
 */
export function ActivityTab() {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [loadError, setLoadError] = useState('');
  const [overridesOnly, setOverridesOnly] = useState(false);

  const load = useCallback(() => {
    apiFetch<{ entries: ActivityEntry[] }>('/admin/activity?limit=100', { auth: true })
      .then((data) => setEntries(data.entries))
      .catch((err: ApiError) => setLoadError(err.message));
  }, []);

  useEffect(load, [load]);

  const shown = overridesOnly ? entries.filter((e) => e.is_override) : entries;

  return (
    <>
      {loadError && <div className="error-banner">{loadError}</div>}

      {/* Deliberately not .date-range-bar: that container stacks its
          labels above their inputs (correct for the reports From/To
          fields, wrong for a checkbox). */}
      <div className="filter-bar">
        <label className="filter-toggle">
          <input
            type="checkbox"
            checked={overridesOnly}
            onChange={(e) => setOverridesOnly(e.target.checked)}
          />
          Admin overrides only
        </label>
        <button className="secondary" onClick={load}>
          Refresh
        </button>
      </div>

      {shown.length === 0 && (
        <div className="empty-state">
          {overridesOnly ? 'No admin overrides recorded yet.' : 'No activity recorded yet.'}
        </div>
      )}

      {shown.length > 0 && (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Who</th>
                <th>Item</th>
                <th>Table</th>
                <th>Change</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((e) => (
                <tr key={e.id}>
                  <td className="nowrap">{new Date(e.created_at).toLocaleString()}</td>
                  <td>
                    {e.actor_name}
                    <span className="sub"> ({e.actor_role})</span>
                  </td>
                  <td>{e.menu_item_name}</td>
                  <td>{e.table_number}</td>
                  <td className="nowrap">
                    <span className={`status-pill status-${e.from_status}`}>
                      {STATUS_LABEL[e.from_status]}
                    </span>{' '}
                    →{' '}
                    <span className={`status-pill status-${e.to_status}`}>{STATUS_LABEL[e.to_status]}</span>
                    {e.is_override && (
                      <span className="override-tag" title="Admin override">
                        <ShieldAlertIcon size={12} />
                        override
                      </span>
                    )}
                    {e.is_backward && <span className="backward-tag">reversed</span>}
                  </td>
                  <td className="sub">{e.reason ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
