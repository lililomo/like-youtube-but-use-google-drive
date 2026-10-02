/** Klien API: cookie same-origin, header CSRF, error seragam ({ error: { code, message } }). */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

function readCookie(name: string): string | null {
  const match = document.cookie.split('; ').find((c) => c.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

export function csrfToken(): string {
  return readCookie('dv_csrf') ?? '';
}

export interface ApiOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Body mentah (mis. file gambar) — dikirim apa adanya dengan Content-Type file. */
  raw?: Blob;
  signal?: AbortSignal;
  keepalive?: boolean;
}

async function refreshCsrf(): Promise<void> {
  await fetch('/api/auth/me', { credentials: 'same-origin' });
}

export async function api<T>(path: string, opts: ApiOptions = {}, retried = false): Promise<T> {
  const method = opts.method ?? 'GET';
  const headers: Record<string, string> = { Accept: 'application/json' };
  const init: RequestInit = { method, credentials: 'same-origin', headers, signal: opts.signal, keepalive: opts.keepalive };
  if (opts.raw) {
    headers['Content-Type'] = opts.raw.type || 'application/octet-stream';
    init.body = opts.raw;
  } else if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(opts.body);
  }
  if (method !== 'GET') {
    if (!csrfToken()) await refreshCsrf();
    headers['X-CSRF-Token'] = csrfToken();
  }

  let res: Response;
  try {
    res = await fetch(`/api${path}`, init);
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    if (method === 'GET' && !retried) {
      await new Promise((r) => setTimeout(r, 800));
      return api<T>(path, opts, true);
    }
    throw new ApiError(0, 'NETWORK', 'Tidak dapat terhubung. Periksa koneksi internet Anda.');
  }

  const isJson = res.headers.get('content-type')?.includes('application/json');
  const data = isJson ? await res.json().catch(() => null) : null;
  if (res.ok) return data as T;

  const err = (data as { error?: { code?: string; message?: string; details?: unknown } } | null)?.error;
  if (res.status === 403 && err?.code === 'CSRF' && !retried) {
    await refreshCsrf();
    return api<T>(path, opts, true);
  }
  throw new ApiError(res.status, err?.code ?? 'HTTP_ERROR', err?.message ?? `Terjadi kesalahan (${res.status})`, err?.details);
}

export const apiGet = <T>(path: string, signal?: AbortSignal) => api<T>(path, { signal });
export const apiPost = <T>(path: string, body?: unknown) => api<T>(path, { method: 'POST', body: body ?? {} });
export const apiPatch = <T>(path: string, body: unknown) => api<T>(path, { method: 'PATCH', body });
export const apiPut = <T>(path: string, body: unknown) => api<T>(path, { method: 'PUT', body });
export const apiDelete = <T>(path: string, body?: unknown) => api<T>(path, { method: 'DELETE', body: body ?? {} });
/** Kirim file (gambar) sebagai body mentah: PUT /api<path>. */
export const apiPutFile = <T>(path: string, file: Blob) => api<T>(path, { method: 'PUT', raw: file });

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return 'Terjadi kesalahan';
}
