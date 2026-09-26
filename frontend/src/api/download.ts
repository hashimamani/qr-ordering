import { API_BASE, ApiError } from './client';

/**
 * Separate from apiFetch, which unconditionally calls res.json() and
 * can't safely be retrofitted for a blob response. First file-download UX
 * in the app -- there's no existing pattern to extend (the QR code is
 * only ever shown inline as a data: URI, never actually downloaded).
 */
export async function downloadFile(path: string, filename: string): Promise<void> {
  const token = sessionStorage.getItem('staffToken');
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, { headers });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new ApiError(res.status, data?.error?.message ?? res.statusText);
  }

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
