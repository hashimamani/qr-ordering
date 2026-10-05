export const API_BASE = import.meta.env.VITE_API_BASE_URL;

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  auth?: boolean;
  // Explicit bearer token, for callers that aren't the staff session
  // (e.g. the platform-admin area) -- takes precedence over `auth`'s
  // staffToken lookup so both token types can share this one fetch
  // wrapper without it needing to know which "kind" of session it is.
  authToken?: string;
}

/**
 * Notified when a request that carried a token comes back 401, i.e. the
 * session died server-side. Subscribers get the token that failed rather
 * than a bare signal, so a provider can clear its own session without
 * also logging out an unrelated one -- staff and platform-admin sessions
 * can both be live in the same tab.
 *
 * Only authenticated requests qualify. A 401 from the login endpoint is
 * a wrong password, not a dead session, and must not trigger any of this.
 */
type UnauthorizedHandler = (failedToken: string) => void;
const unauthorizedHandlers = new Set<UnauthorizedHandler>();

export function onUnauthorized(handler: UnauthorizedHandler): () => void {
  unauthorizedHandlers.add(handler);
  return () => {
    unauthorizedHandlers.delete(handler);
  };
}

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  let sentToken: string | undefined;
  if (options.authToken) {
    sentToken = options.authToken;
    headers['Authorization'] = `Bearer ${options.authToken}`;
  } else if (options.auth) {
    const token = sessionStorage.getItem('staffToken');
    if (token) {
      sentToken = token;
      headers['Authorization'] = `Bearer ${token}`;
    }
  }

  const res = await fetch(`${API_BASE}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  if (res.status === 204) return undefined as T;

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && sentToken) {
      for (const handler of unauthorizedHandlers) handler(sentToken);
    }
    const message = data?.error?.message ?? res.statusText;
    throw new ApiError(res.status, message);
  }
  return data as T;
}
