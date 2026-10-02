import { createReadStream, statSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { JWT, OAuth2Client } from 'google-auth-library';
import { Agent, request, type Dispatcher } from 'undici';
import { config } from '../../config.js';
import { sha256Hex } from '../../lib/crypto.js';
import { settings } from '../settings/service.js';
import { FOLDER_MIME, type DriveFile } from './classify.js';

const API = config.DRIVE_API_BASE;
const UPLOAD_API = config.DRIVE_UPLOAD_BASE;
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive';
export const OAUTH_SCOPES = [DRIVE_SCOPE, 'openid', 'email'];
export const REDIRECT_URI = `${config.APP_URL}/api/admin/drive/oauth/callback`;
export const FILE_FIELDS =
  'id,name,mimeType,size,md5Checksum,parents,trashed,createdTime,modifiedTime,appProperties,videoMediaMetadata(width,height,durationMillis)';

/** Koneksi keep-alive ke Google (dipakai juga untuk streaming). */
export const driveAgent = new Agent({ connections: 64, keepAliveTimeout: 30_000, keepAliveMaxTimeout: 600_000 });

export class DriveError extends Error {
  constructor(
    readonly status: number,
    readonly reason: string,
    message: string,
  ) {
    super(message);
  }
}

// ---------------------------------------------------------------------------
// Token
// ---------------------------------------------------------------------------

export function newOAuthClient(clientId: string, clientSecret: string): OAuth2Client {
  return new OAuth2Client({ clientId, clientSecret, redirectUri: REDIRECT_URI });
}

class TokenProvider {
  private client: OAuth2Client | JWT | null = null;
  private signature = '';

  private build(): OAuth2Client | JWT {
    if (settings.get('drive.auth_mode') === 'service_account') {
      const json = settings.getSecret('drive.service_account_json');
      if (!json) throw new DriveError(412, 'NOT_CONFIGURED', 'Service account Google Drive belum diatur');
      const sig = `sa:${sha256Hex(json)}`;
      if (this.client && this.signature === sig) return this.client;
      const cred = JSON.parse(json) as { client_email: string; private_key: string };
      this.client = new JWT({ email: cred.client_email, key: cred.private_key, scopes: [DRIVE_SCOPE] });
      this.signature = sig;
      return this.client;
    }
    const id = settings.get('drive.oauth_client_id');
    const secret = settings.getSecret('drive.oauth_client_secret');
    const refresh = settings.getSecret('drive.oauth_refresh_token');
    if (!id || !secret || !refresh) throw new DriveError(412, 'NOT_CONNECTED', 'Google Drive belum terhubung');
    const sig = `oauth:${sha256Hex(`${id}\n${secret}\n${refresh}`)}`;
    if (this.client && this.signature === sig) return this.client;
    const client = newOAuthClient(id, secret);
    client.setCredentials({ refresh_token: refresh });
    client.on('tokens', (tokens) => {
      // Google bisa merotasi refresh token; simpan yang baru.
      if (tokens.refresh_token && tokens.refresh_token !== refresh) {
        void settings.set({ 'drive.oauth_refresh_token': tokens.refresh_token });
      }
    });
    this.client = client;
    this.signature = sig;
    return client;
  }

  async token(forceRefresh = false): Promise<string> {
    if (config.DRIVE_FAKE_TOKEN) return config.DRIVE_FAKE_TOKEN;
    const client = this.build();
    if (forceRefresh) client.credentials = { ...client.credentials, access_token: undefined, expiry_date: 0 };
    try {
      const { token } = await client.getAccessToken();
      if (!token) throw new Error('token kosong');
      return token;
    } catch (err) {
      const msg = String((err as { response?: { data?: { error?: string } } }).response?.data?.error ?? (err as Error).message);
      if (msg.includes('invalid_grant') || msg.includes('unauthorized_client') || msg.includes('invalid_client')) {
        const friendly = 'Token Google tidak valid atau kedaluwarsa. Hubungkan ulang Google Drive di Panel Admin.';
        void settings.set({ 'drive.last_sync_error': friendly });
        throw new DriveError(401, 'INVALID_GRANT', friendly);
      }
      throw new DriveError(502, 'TOKEN_ERROR', `Gagal mendapatkan token Google: ${msg}`);
    }
  }

  reset(): void {
    this.client = null;
    this.signature = '';
  }
}

export const driveAuth = new TokenProvider();

export function isDriveConfigured(): boolean {
  if (config.DRIVE_FAKE_TOKEN) return true;
  if (settings.get('drive.auth_mode') === 'service_account') return settings.hasSecret('drive.service_account_json');
  return Boolean(settings.get('drive.oauth_client_id')) && settings.hasSecret('drive.oauth_client_secret') && settings.hasSecret('drive.oauth_refresh_token');
}

// ---------------------------------------------------------------------------
// HTTP dengan retry
// ---------------------------------------------------------------------------

type Query = Record<string, string | number | boolean | undefined | null>;

function buildUrl(base: string, query?: Query): string {
  const url = new URL(base);
  for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  return url.toString();
}

const RETRY_REASONS = new Set(['rateLimitExceeded', 'userRateLimitExceeded', 'backendError', 'internalError']);

function parseError(status: number, text: string): DriveError {
  try {
    const j = JSON.parse(text) as { error?: { message?: string; errors?: { reason?: string }[]; status?: string } };
    const reason = j.error?.errors?.[0]?.reason ?? j.error?.status ?? `HTTP_${status}`;
    return new DriveError(status, reason, j.error?.message ?? `Google Drive error ${status}`);
  } catch {
    return new DriveError(status, `HTTP_${status}`, text.slice(0, 300) || `Google Drive error ${status}`);
  }
}

const backoffMs = (attempt: number) => Math.min(8000, 500 * 2 ** attempt) + Math.floor(Math.random() * 250);

interface CallOptions {
  query?: Query;
  headers?: Record<string, string>;
  body?: string | Buffer | NodeJS.ReadableStream | null;
  signal?: AbortSignal;
  /** Jumlah retry untuk 429/5xx (default 5; 0 untuk body stream yang tidak bisa diulang). */
  retries?: number;
}

/** Request ke Drive. Mengembalikan respons sukses (status < 400) apa adanya; error → DriveError. */
export async function driveRequest(
  method: Dispatcher.HttpMethod,
  url: string,
  opts: CallOptions = {},
): Promise<Dispatcher.ResponseData> {
  const maxRetries = opts.retries ?? 5;
  let refreshed = false;
  for (let attempt = 0; ; attempt++) {
    const token = await driveAuth.token(false);
    const res = await request(buildUrl(url, opts.query), {
      method,
      headers: { authorization: `Bearer ${token}`, ...opts.headers },
      body: opts.body as Dispatcher.DispatchOptions['body'],
      dispatcher: driveAgent,
      signal: opts.signal,
      headersTimeout: 60_000,
      bodyTimeout: 0,
    });
    if (res.statusCode < 400) return res;

    const text = await res.body.text().catch(() => '');
    const err = parseError(res.statusCode, text);
    if (res.statusCode === 401 && !refreshed) {
      refreshed = true;
      await driveAuth.token(true);
      continue;
    }
    const retryable = res.statusCode === 429 || res.statusCode >= 500 || (res.statusCode === 403 && RETRY_REASONS.has(err.reason));
    if (retryable && attempt < maxRetries) {
      await sleep(backoffMs(attempt));
      continue;
    }
    throw err;
  }
}

async function driveJson<T>(method: Dispatcher.HttpMethod, path: string, opts: CallOptions & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = opts;
  const res = await driveRequest(method, path.startsWith('http') ? path : `${API}${path}`, {
    ...rest,
    query: { supportsAllDrives: true, ...rest.query },
    headers: json !== undefined ? { 'content-type': 'application/json; charset=UTF-8', ...rest.headers } : rest.headers,
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  const text = await res.body.text();
  return (text ? JSON.parse(text) : {}) as T;
}

// ---------------------------------------------------------------------------
// Operasi Drive
// ---------------------------------------------------------------------------

function listScope(): Query {
  const driveId = settings.get('drive.shared_drive_id');
  return driveId
    ? { corpora: 'drive', driveId, includeItemsFromAllDrives: true, supportsAllDrives: true }
    : { supportsAllDrives: true };
}

export async function about(): Promise<{ user?: { emailAddress?: string; displayName?: string } }> {
  return driveJson('GET', '/about', { query: { fields: 'user(emailAddress,displayName)' } });
}

export async function getFile(id: string, fields = `${FILE_FIELDS},driveId,capabilities(canAddChildren,canListChildren)`): Promise<DriveFile & { capabilities?: { canAddChildren?: boolean; canListChildren?: boolean } }> {
  return driveJson('GET', `/files/${encodeURIComponent(id)}`, { query: { fields } });
}

/** Semua anak langsung sebuah folder (paging otomatis). */
export async function* listChildren(folderId: string, extraQ = ''): AsyncGenerator<DriveFile[]> {
  let pageToken: string | undefined;
  do {
    const res = await driveJson<{ files?: DriveFile[]; nextPageToken?: string }>('GET', '/files', {
      query: {
        ...listScope(),
        q: `'${folderId}' in parents and trashed = false${extraQ ? ` and ${extraQ}` : ''}`,
        fields: `nextPageToken,files(${FILE_FIELDS})`,
        pageSize: 1000,
        pageToken,
      },
    });
    yield res.files ?? [];
    pageToken = res.nextPageToken;
  } while (pageToken);
}

export async function findChildFolder(parentId: string, name: string): Promise<DriveFile | null> {
  const escaped = name.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  for await (const page of listChildren(parentId, `mimeType = '${FOLDER_MIME}' and name = '${escaped}'`)) {
    if (page[0]) return page[0];
  }
  return null;
}

export async function createFolder(name: string, parentId: string, appProperties?: Record<string, string>): Promise<DriveFile> {
  return driveJson('POST', '/files', {
    query: { fields: FILE_FIELDS },
    json: { name, mimeType: FOLDER_MIME, parents: [parentId], appProperties },
  });
}

export async function updateFile(
  id: string,
  patch: { name?: string; appProperties?: Record<string, string | null>; trashed?: boolean },
  opts: { addParents?: string; removeParents?: string } = {},
): Promise<DriveFile> {
  return driveJson('PATCH', `/files/${encodeURIComponent(id)}`, {
    query: { fields: FILE_FIELDS, addParents: opts.addParents, removeParents: opts.removeParents },
    json: patch,
  });
}

/** Pindahkan ke Trash (bukan hapus permanen). */
export async function trashFile(id: string): Promise<void> {
  await updateFile(id, { trashed: true });
}

export async function getStartPageToken(): Promise<string> {
  const driveId = settings.get('drive.shared_drive_id');
  const res = await driveJson<{ startPageToken: string }>('GET', '/changes/startPageToken', {
    query: driveId ? { driveId, supportsAllDrives: true } : {},
  });
  return res.startPageToken;
}

export interface DriveChange {
  fileId: string;
  removed?: boolean;
  file?: DriveFile;
}

export async function listChanges(pageToken: string): Promise<{ changes: DriveChange[]; nextPageToken?: string; newStartPageToken?: string }> {
  const driveId = settings.get('drive.shared_drive_id');
  const res = await driveJson<{ changes?: DriveChange[]; nextPageToken?: string; newStartPageToken?: string }>('GET', '/changes', {
    query: {
      pageToken,
      pageSize: 1000,
      includeRemoved: true,
      spaces: 'drive',
      fields: `nextPageToken,newStartPageToken,changes(fileId,removed,file(${FILE_FIELDS}))`,
      ...(driveId ? { driveId, includeItemsFromAllDrives: true } : {}),
    },
  });
  return { changes: res.changes ?? [], nextPageToken: res.nextPageToken, newStartPageToken: res.newStartPageToken };
}

/** GET media dengan Range opsional (untuk streaming & ffmpeg). */
export async function mediaRequest(
  fileId: string,
  opts: { range?: string; ifRange?: string; signal?: AbortSignal } = {},
): Promise<Dispatcher.ResponseData> {
  const headers: Record<string, string> = {};
  if (opts.range) headers.range = opts.range;
  if (opts.ifRange) headers['if-range'] = opts.ifRange;
  return driveRequest('GET', `${API}/files/${encodeURIComponent(fileId)}`, {
    query: { alt: 'media', acknowledgeAbuse: true, supportsAllDrives: true },
    headers,
    signal: opts.signal,
    retries: 2,
  });
}

/** Buat sesi upload resumable; mengembalikan URL sesi. */
export async function createResumableSession(meta: {
  name: string;
  mimeType: string;
  size: number;
  parents: string[];
  appProperties?: Record<string, string>;
}): Promise<string> {
  const res = await driveRequest('POST', `${UPLOAD_API}/files`, {
    query: { uploadType: 'resumable', supportsAllDrives: true, fields: FILE_FIELDS },
    headers: {
      'content-type': 'application/json; charset=UTF-8',
      'x-upload-content-type': meta.mimeType,
      'x-upload-content-length': String(meta.size),
    },
    body: JSON.stringify({ name: meta.name, mimeType: meta.mimeType, parents: meta.parents, appProperties: meta.appProperties }),
  });
  await res.body.dump();
  const location = res.headers.location;
  const url = Array.isArray(location) ? location[0] : location;
  if (!url) throw new DriveError(502, 'NO_SESSION', 'Google Drive tidak mengembalikan URL sesi upload');
  return url;
}

/** Kirim seluruh file lokal ke sesi resumable dalam satu PUT (stream). */
async function putFileToSession(session: string, path: string, size: number, mimeType: string, signal?: AbortSignal): Promise<DriveFile> {
  const res = await request(session, {
    method: 'PUT',
    headers: { 'content-length': String(size), 'content-type': mimeType },
    body: createReadStream(path),
    dispatcher: driveAgent,
    signal,
    headersTimeout: 0,
    bodyTimeout: 0,
  });
  const text = await res.body.text();
  if (res.statusCode !== 200 && res.statusCode !== 201) throw parseError(res.statusCode, text);
  return JSON.parse(text) as DriveFile;
}

/** Upload file lokal (mis. rendition) via sesi resumable, satu PUT dengan stream. */
export async function uploadFileFromDisk(
  path: string,
  meta: { name: string; mimeType: string; parents: string[]; appProperties?: Record<string, string> },
): Promise<DriveFile> {
  const size = statSync(path).size;
  const session = await createResumableSession({ ...meta, size });
  return putFileToSession(session, path, size, meta.mimeType);
}

/**
 * Ganti isi file Drive yang sudah ada dengan file lokal (revisi baru; ID, nama, folder & izin berbagi tetap).
 * Atomik di sisi Google: bila upload gagal di tengah, isi lama tetap utuh.
 */
export async function replaceFileContentFromDisk(
  fileId: string,
  path: string,
  meta: { mimeType: string; appProperties?: Record<string, string> },
  signal?: AbortSignal,
): Promise<DriveFile> {
  const size = statSync(path).size;
  const res = await driveRequest('PATCH', `${UPLOAD_API}/files/${encodeURIComponent(fileId)}`, {
    query: { uploadType: 'resumable', supportsAllDrives: true, fields: FILE_FIELDS },
    headers: {
      'content-type': 'application/json; charset=UTF-8',
      'x-upload-content-type': meta.mimeType,
      'x-upload-content-length': String(size),
    },
    body: JSON.stringify(meta.appProperties ? { appProperties: meta.appProperties } : {}),
    signal,
  });
  await res.body.dump();
  const location = res.headers.location;
  const session = Array.isArray(location) ? location[0] : location;
  if (!session) throw new DriveError(502, 'NO_SESSION', 'Google Drive tidak mengembalikan URL sesi upload');
  return putFileToSession(session, path, size, meta.mimeType, signal);
}

export interface DriveRevision {
  id: string;
  modifiedTime?: string;
  size?: string;
  md5Checksum?: string;
  keepForever?: boolean;
}

/** Revisi isi file biner (urut dari terlama). */
export async function listRevisions(fileId: string): Promise<DriveRevision[]> {
  const res = await driveJson<{ revisions?: DriveRevision[] }>('GET', `/files/${encodeURIComponent(fileId)}/revisions`, {
    query: { supportsAllDrives: undefined, fields: 'revisions(id,modifiedTime,size,md5Checksum,keepForever)', pageSize: 200 },
  });
  return res.revisions ?? [];
}

/** Hapus permanen satu revisi lama (revisi terakhir tidak bisa dihapus). */
export async function deleteRevision(fileId: string, revisionId: string): Promise<void> {
  await driveJson('DELETE', `/files/${encodeURIComponent(fileId)}/revisions/${encodeURIComponent(revisionId)}`, {
    query: { supportsAllDrives: undefined },
  });
}

/** Izin edit akun aplikasi atas file (mis. file "dibagikan kepada saya" bisa read-only). */
export async function canEditFile(fileId: string): Promise<boolean> {
  const f = await driveJson<{ capabilities?: { canEdit?: boolean } }>('GET', `/files/${encodeURIComponent(fileId)}`, {
    query: { fields: 'capabilities(canEdit)' },
  });
  return f.capabilities?.canEdit === true;
}

/** Cabut refresh token di Google (best effort). */
export async function revokeToken(token: string): Promise<void> {
  try {
    const res = await request(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      dispatcher: driveAgent,
    });
    await res.body.dump();
  } catch {
    /* abaikan */
  }
}
