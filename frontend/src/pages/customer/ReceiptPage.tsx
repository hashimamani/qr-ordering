import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { apiFetch, ApiError } from '../../api/client';
import { downloadFile } from '../../api/download';
import type { ReceiptChallengePrompt, ReceiptDetail, VerifiedReceipt } from '../../api/types';
import { useToast } from '../../components/ToastProvider';
import { useBrandColor } from '../../hooks/useBrandColor';
import { DownloadIcon } from '../../components/icons';

function money(value: string): string {
  return `KSh ${Number(value).toLocaleString('en-KE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function when(iso: string): string {
  return new Date(iso).toLocaleString('en-KE', { timeZone: 'Africa/Nairobi' });
}

export function ReceiptPage() {
  const { token } = useParams<{ token: string }>();
  const showToast = useToast();
  const [prompt, setPrompt] = useState<ReceiptChallengePrompt | null>(null);
  const [linkDead, setLinkDead] = useState(false);
  const [answer, setAnswer] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [receipt, setReceipt] = useState<ReceiptDetail | null>(null);
  const [grant, setGrant] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  useBrandColor(receipt?.brand_color);

  const load = useCallback(() => {
    if (!token) return;
    apiFetch<ReceiptChallengePrompt>(`/receipt/${token}`)
      .then(setPrompt)
      // The server returns the same response for unknown, expired and
      // burnt links on purpose, so this page can only say the one thing.
      .catch(() => setLinkDead(true));
  }, [token]);

  useEffect(load, [load]);

  async function verify() {
    if (!token || !answer.trim()) return;
    setVerifying(true);
    try {
      const result = await apiFetch<VerifiedReceipt>(`/receipt/${token}/verify`, {
        method: 'POST',
        body: { answer: answer.trim() },
      });
      setReceipt(result.receipt);
      setGrant(result.download_grant);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) setLinkDead(true);
      else showToast(err instanceof ApiError ? err.message : 'Something went wrong.');
    } finally {
      setVerifying(false);
    }
  }

  async function download() {
    if (!token || !grant) return;
    setDownloading(true);
    try {
      await downloadFile(`/receipt/${token}/pdf`, `receipt_${token.slice(0, 8)}.pdf`, grant);
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Something went wrong.');
    } finally {
      setDownloading(false);
    }
  }

  if (linkDead) {
    return (
      <>
        <header>
          <h1>Receipt</h1>
        </header>
        <main className="auth">
          <div className="card">
            <h3 style={{ marginTop: 0 }}>This link is no longer available</h3>
            <p className="sub">
              Receipt links expire for your security. Ask the restaurant if you still need a copy.
            </p>
          </div>
        </main>
      </>
    );
  }

  if (receipt) {
    return (
      <>
        <header>
          <h1>{receipt.restaurant_name}</h1>
          <div className="sub">Receipt &middot; Table {receipt.table_number}</div>
        </header>
        <main>
          <div className="card">
            <div className="receipt-meta">
              <div>
                <span className="sub">Paid</span>
                <div>{when(receipt.paid_at)}</div>
              </div>
              <div>
                <span className="sub">Order reference</span>
                <div className="receipt-ref">{receipt.order_public_token}</div>
              </div>
            </div>

            <table className="data-table receipt-table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th className="num">Qty</th>
                  <th className="num">Unit</th>
                  <th className="num">Amount</th>
                </tr>
              </thead>
              <tbody>
                {receipt.items.map((item, i) => (
                  <tr key={`${item.menu_item_name}-${i}`}>
                    <td>{item.menu_item_name}</td>
                    <td className="num">{item.quantity}</td>
                    <td className="num">{money(item.unit_price)}</td>
                    <td className="num">{money(item.line_total)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={3} className="receipt-total-label">
                    Total
                  </td>
                  <td className="num receipt-total">{money(receipt.total)}</td>
                </tr>
              </tfoot>
            </table>

            <p className="report-footnote">
              Total is the sum of the items listed. No taxes or service charges are applied or itemised.
            </p>

            {receipt.prices_reconstructed && (
              <p className="receipt-warning">
                This order predates itemised price records. Prices shown were reconstructed from the menu
                and may differ from the amount charged.
              </p>
            )}

            <button className="primary" onClick={download} disabled={downloading}>
              <DownloadIcon size={15} />
              {downloading ? 'Preparing…' : 'Download PDF'}
            </button>
          </div>
        </main>
      </>
    );
  }

  return (
    <>
      <header>
        <h1>Receipt</h1>
        <div className="sub">Confirm it's you</div>
      </header>
      <main className="auth">
        <div className="card">
          {!prompt && <div className="empty-state">Loading…</div>}
          {prompt && (
            <>
              <p className="sub" style={{ marginTop: 0 }}>
                {prompt.channel === 'sms' ? (
                  <>
                    This receipt was sent to <strong>{prompt.hint}</strong>. Enter the last 4 digits of that
                    number to view it.
                  </>
                ) : (
                  <>
                    This receipt was sent to <strong>{prompt.hint}</strong>. Enter that email address to view
                    it.
                  </>
                )}
              </p>
              <label htmlFor="answer">
                {prompt.channel === 'sms' ? 'Last 4 digits' : 'Email address'}
              </label>
              <input
                id="answer"
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                inputMode={prompt.channel === 'sms' ? 'numeric' : 'email'}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                placeholder={prompt.channel === 'sms' ? '••••' : 'you@example.com'}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') verify();
                }}
              />
              <button className="primary" onClick={verify} disabled={verifying || !answer.trim()}>
                {verifying ? 'Checking…' : 'View receipt'}
              </button>
            </>
          )}
        </div>
      </main>
    </>
  );
}
