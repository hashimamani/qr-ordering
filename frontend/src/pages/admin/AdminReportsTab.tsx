import { useCallback, useEffect, useState } from 'react';
import { apiFetch, ApiError } from '../../api/client';
import { downloadFile } from '../../api/download';
import type {
  TodaySummary,
  ReportSummary,
  BreakdownDimension,
  BreakdownResponse,
} from '../../api/types';
import { useAuth } from '../../auth/AuthContext';
import { useRealtime } from '../../hooks/useRealtime';
import { useToast } from '../../components/ToastProvider';
import { DownloadIcon } from '../../components/icons';
import { RevenueBarChart } from './RevenueBarChart';

type Preset = 'today' | '7d' | '30d' | 'this_month' | 'last_month';

const DIMENSION_LABELS: Record<BreakdownDimension, string> = {
  menu_item: 'Menu item',
  category: 'Category',
  waiter: 'Waiter',
  table: 'Table',
};

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function presetRange(preset: Preset): { from: string; to: string } {
  const now = new Date();
  const today = toDateStr(now);
  switch (preset) {
    case 'today':
      return { from: today, to: today };
    case '7d': {
      const from = new Date(now);
      from.setDate(from.getDate() - 6);
      return { from: toDateStr(from), to: today };
    }
    case '30d': {
      const from = new Date(now);
      from.setDate(from.getDate() - 29);
      return { from: toDateStr(from), to: today };
    }
    case 'this_month': {
      const from = new Date(now.getFullYear(), now.getMonth(), 1);
      return { from: toDateStr(from), to: today };
    }
    case 'last_month': {
      const from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const to = new Date(now.getFullYear(), now.getMonth(), 0);
      return { from: toDateStr(from), to: toDateStr(to) };
    }
  }
}

function money(v: string): string {
  return `KSh ${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function AdminReportsTab() {
  const { session } = useAuth();
  const showToast = useToast();

  const [today, setToday] = useState<TodaySummary | null>(null);
  const [range, setRange] = useState(() => presetRange('30d'));
  const [summary, setSummary] = useState<ReportSummary | null>(null);
  const [dimension, setDimension] = useState<BreakdownDimension>('menu_item');
  const [breakdown, setBreakdown] = useState<BreakdownResponse | null>(null);
  const [loadError, setLoadError] = useState('');
  const [downloading, setDownloading] = useState<string | null>(null);
  const [csvDataset, setCsvDataset] = useState<BreakdownDimension | 'order_items'>('order_items');

  const loadToday = useCallback(() => {
    apiFetch<TodaySummary>('/admin/reports/today', { auth: true })
      .then(setToday)
      .catch((err: ApiError) => setLoadError(err.message));
  }, []);

  const loadSummary = useCallback(() => {
    const params = new URLSearchParams({ from: range.from, to: range.to });
    apiFetch<ReportSummary>(`/admin/reports/summary?${params}`, { auth: true })
      .then(setSummary)
      .catch((err: ApiError) => setLoadError(err.message));
  }, [range]);

  const loadBreakdown = useCallback(() => {
    const params = new URLSearchParams({ from: range.from, to: range.to, dimension });
    apiFetch<BreakdownResponse>(`/admin/reports/breakdown?${params}`, { auth: true })
      .then(setBreakdown)
      .catch((err: ApiError) => setLoadError(err.message));
  }, [range, dimension]);

  useEffect(loadToday, [loadToday]);
  useEffect(loadSummary, [loadSummary]);
  useEffect(loadBreakdown, [loadBreakdown]);

  const { connected } = useRealtime(
    session ? `restaurant:${session.restaurantId}:admin` : null,
    session?.token ?? null,
    () => loadToday(),
  );

  async function handleExport(format: 'csv' | 'pdf' | 'xlsx') {
    const key = format === 'csv' ? `csv:${csvDataset}` : format;
    setDownloading(key);
    try {
      const params = new URLSearchParams({ from: range.from, to: range.to, format });
      if (format === 'csv') params.set('dataset', csvDataset);
      const ext = format === 'xlsx' ? 'xlsx' : format;
      const suffix = format === 'csv' ? `_${csvDataset}` : '';
      await downloadFile(`/admin/reports/export?${params}`, `sales-report_${range.from}_${range.to}${suffix}.${ext}`);
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Something went wrong.');
    } finally {
      setDownloading(null);
    }
  }

  return (
    <div>
      {loadError && <div className="error-banner">{loadError}</div>}

      <div className="stat-grid" style={{ marginBottom: 20 }}>
        <div className="stat-tile">
          <div className="stat-label">
            <span className={`conn-dot ${connected ? 'live' : ''}`} /> Sales today
          </div>
          <div className="stat-value">{today ? money(today.gross_sales) : '—'}</div>
          <div className="stat-sub">{today ? `${today.order_count} orders` : ''}</div>
        </div>
        <div className="stat-tile positive">
          <div className="stat-label">Paid today</div>
          <div className="stat-value">{today ? money(today.paid_sales) : '—'}</div>
        </div>
        <div className="stat-tile warn">
          <div className="stat-label">Outstanding today</div>
          <div className="stat-value">{today ? money(today.unpaid_sales) : '—'}</div>
        </div>
        <div className="stat-tile">
          <div className="stat-label">Items sold today</div>
          <div className="stat-value">{today ? today.item_count : '—'}</div>
        </div>
      </div>

      <div className="date-range-bar">
        {(['today', '7d', '30d', 'this_month', 'last_month'] as Preset[]).map((p) => (
          <button key={p} className="secondary" onClick={() => setRange(presetRange(p))}>
            {{ today: 'Today', '7d': 'Last 7 days', '30d': 'Last 30 days', this_month: 'This month', last_month: 'Last month' }[p]}
          </button>
        ))}
        <label style={{ marginLeft: 8 }}>
          From
          <input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} />
        </label>
        <label>
          To
          <input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} />
        </label>
      </div>

      {summary && (
        <div className="stat-grid" style={{ marginBottom: 20 }}>
          <div className="stat-tile">
            <div className="stat-label">Gross sales</div>
            <div className="stat-value">{money(summary.totals.gross_sales)}</div>
          </div>
          <div className="stat-tile positive">
            <div className="stat-label">Paid sales</div>
            <div className="stat-value">{money(summary.totals.paid_sales)}</div>
          </div>
          <div className="stat-tile warn">
            <div className="stat-label">Outstanding</div>
            <div className="stat-value">{money(summary.totals.unpaid_sales)}</div>
          </div>
          <div className="stat-tile">
            <div className="stat-label">Orders</div>
            <div className="stat-value">{summary.totals.order_count}</div>
            <div className="stat-sub">Avg {money(summary.totals.average_order_value)}</div>
          </div>
        </div>
      )}

      <div className="card report-chart" style={{ marginBottom: 20 }}>
        <h3 style={{ marginTop: 0 }}>Revenue by day</h3>
        {summary && <RevenueBarChart days={summary.by_day} />}
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <div className="tabs" style={{ marginBottom: 12 }}>
          {(Object.keys(DIMENSION_LABELS) as BreakdownDimension[]).map((d) => (
            <button key={d} className={dimension === d ? 'active' : ''} onClick={() => setDimension(d)}>
              {DIMENSION_LABELS[d]}
            </button>
          ))}
        </div>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>{DIMENSION_LABELS[dimension]}</th>
                <th>Qty</th>
                <th>Gross</th>
                <th>Paid</th>
                <th>Orders</th>
                <th>Share</th>
              </tr>
            </thead>
            <tbody>
              {breakdown?.rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="empty-state">
                    No sales in this range.
                  </td>
                </tr>
              )}
              {breakdown?.rows.map((r) => (
                <tr key={r.key ?? r.label}>
                  <td>{r.label}</td>
                  <td>{r.quantity}</td>
                  <td>{money(r.gross_sales)}</td>
                  <td>{money(r.paid_sales)}</td>
                  <td>{r.order_count}</td>
                  <td>
                    <div className="share-bar">
                      <span style={{ width: `${(r.share_of_sales * 100).toFixed(1)}%` }} />
                    </div>
                    <div className="stat-sub">{(r.share_of_sales * 100).toFixed(1)}%</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Download report</h3>
        <div className="export-bar">
          <select value={csvDataset} onChange={(e) => setCsvDataset(e.target.value as BreakdownDimension | 'order_items')}>
            <option value="order_items">Raw line items</option>
            {(Object.keys(DIMENSION_LABELS) as BreakdownDimension[]).map((d) => (
              <option key={d} value={d}>
                By {DIMENSION_LABELS[d].toLowerCase()}
              </option>
            ))}
          </select>
          <button className="secondary" disabled={!!downloading} onClick={() => handleExport('csv')}>
            <DownloadIcon size={16} />
            {downloading === `csv:${csvDataset}` ? 'Downloading…' : 'CSV'}
          </button>
          <button className="secondary" disabled={!!downloading} onClick={() => handleExport('pdf')}>
            <DownloadIcon size={16} />
            {downloading === 'pdf' ? 'Downloading…' : 'PDF'}
          </button>
          <button className="secondary" disabled={!!downloading} onClick={() => handleExport('xlsx')}>
            <DownloadIcon size={16} />
            {downloading === 'xlsx' ? 'Downloading…' : 'Excel'}
          </button>
        </div>
        <p className="report-footnote">
          PDF and Excel include every breakdown for the selected range in one file. CSV exports the
          selected dataset only, for pivoting elsewhere.
        </p>
        <p className="report-footnote">
          Orders placed before reporting was enabled use each menu item&rsquo;s price and each
          table&rsquo;s waiter assignment at the time this feature launched, not necessarily at the
          time of the order. All orders since then are exact. The dashboard reflects reporting data
          written a moment after each event -- usually near-instant, but not guaranteed to be
          instantaneous.
        </p>
      </div>
    </div>
  );
}
