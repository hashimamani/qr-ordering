const API_BASE = import.meta.env.VITE_API_BASE_URL;

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

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.authToken) {
    headers['Authorization'] = `Bearer ${options.authToken}`;
  } else if (options.auth) {
    const token = localStorage.getItem('staffToken');
    if (token) headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  if (res.status === 204) return undefined as T;

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const message = data?.error?.message ?? res.statusText;
    throw new ApiError(res.status, message);
  }
  return data as T;
}
