import { create } from 'zustand';
import { ApiError, apiDelete, apiGet, apiPost, csrfToken } from '../lib/api';
import { storage } from '../lib/storage';

/**
 * UploadManager (SPEC §11 klien): antrean multi-file, 2 file paralel, chunk berurutan via XHR (progres),
 * retry backoff 1-2-4-8-16-30 dtk hingga 10× lalu "Dijeda", lanjut saat online, dan
 * melanjutkan setelah halaman dimuat ulang (pilih file yang sama; dicocokkan nama+ukuran+lastModified).
 */
export type UploadStatus = 'queued' | 'starting' | 'uploading' | 'retrying' | 'paused' | 'needs-file' | 'done' | 'error' | 'cancelled';

export interface UploadItem {
  key: string;
  file: File | null;
  name: string;
  size: number;
  lastModified: number;
  visibility: 'public' | 'private';
  categoryId: number | null;
  subtitle: { file: File; lang: string } | null;
  uploadId: string | null;
  received: number;
  status: UploadStatus;
  error: string | null;
  videoId: string | null;
  attempts: number;
  retryAt: number | null;
  speed: number | null;
}

interface ServerUpload {
  uploadId: string;
  fileName: string;
  size: number;
  received: number;
  status: 'uploading' | 'completed' | 'failed' | 'cancelled' | 'expired';
  videoId: string | null;
  error: string | null;
  chunkSize: number;
  done?: boolean;
}

interface Persisted {
  uploadId: string;
  name: string;
  size: number;
  lastModified: number;
  visibility: 'public' | 'private';
}

const LS_KEY = 'dv.uploads';
const PARALLEL = 2;
const BACKOFF = [1, 2, 4, 8, 16, 30, 30, 30, 30, 30];

const xhrs = new Map<string, XMLHttpRequest>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
let seq = 0;

function persist(items: UploadItem[]): void {
  const list: Persisted[] = items
    .filter((i) => i.uploadId && ['starting', 'uploading', 'retrying', 'paused', 'needs-file', 'queued'].includes(i.status))
    .map((i) => ({ uploadId: i.uploadId!, name: i.name, size: i.size, lastModified: i.lastModified, visibility: i.visibility }));
  storage.set(LS_KEY, list);
}

interface UploadState {
  items: UploadItem[];
  panelOpen: boolean;
  dialogOpen: boolean;
  collapsed: boolean;
  completed: number;
  restored: boolean;
  openDialog: () => void;
  closeDialog: () => void;
  setCollapsed: (v: boolean) => void;
  closePanel: () => void;
  add: (files: { file: File; subtitle?: { file: File; lang: string } | null }[], opts: { visibility: 'public' | 'private'; categoryId: number | null }) => void;
  cancel: (key: string) => void;
  retry: (key: string) => void;
  remove: (key: string) => void;
  provideFile: (key: string, file: File) => string | null;
  restore: () => Promise<void>;
  resumePaused: () => void;
}

export const useUploads = create<UploadState>((set, get) => {
  const patch = (key: string, p: Partial<UploadItem>) => {
    set((s) => ({ items: s.items.map((i) => (i.key === key ? { ...i, ...p } : i)) }));
    persist(get().items);
  };
  const find = (key: string) => get().items.find((i) => i.key === key);

  const pump = () => {
    const active = get().items.filter((i) => i.status === 'starting' || i.status === 'uploading').length;
    let free = PARALLEL - active;
    for (const it of get().items) {
      if (free <= 0) break;
      if (it.status === 'queued' && it.file) {
        free--;
        void run(it.key);
      }
    }
  };

  /** PUT satu chunk via XHR (progres per byte). */
  const sendChunk = (it: UploadItem, start: number, end: number, onProgress: (loaded: number) => void) =>
    new Promise<ServerUpload>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhrs.set(it.key, xhr);
      xhr.open('PUT', `/api/uploads/${it.uploadId}`);
      xhr.setRequestHeader('Content-Type', 'application/octet-stream');
      xhr.setRequestHeader('Content-Range', `bytes ${start}-${end - 1}/${it.size}`);
      xhr.setRequestHeader('X-CSRF-Token', csrfToken());
      xhr.upload.onprogress = (e) => onProgress(e.loaded);
      xhr.onload = () => {
        xhrs.delete(it.key);
        let data: unknown = null;
        try {
          data = JSON.parse(xhr.responseText);
        } catch {
          /* bukan JSON */
        }
        if (xhr.status >= 200 && xhr.status < 300) resolve(data as ServerUpload);
        else {
          const e = (data as { error?: { code?: string; message?: string; details?: unknown } } | null)?.error;
          reject(new ApiError(xhr.status, e?.code ?? 'HTTP_ERROR', e?.message ?? `Upload gagal (${xhr.status})`, e?.details));
        }
      };
      xhr.onerror = () => {
        xhrs.delete(it.key);
        reject(new ApiError(0, 'NETWORK', 'Koneksi terputus'));
      };
      xhr.onabort = () => {
        xhrs.delete(it.key);
        reject(new ApiError(0, 'ABORTED', 'Dibatalkan'));
      };
      xhr.send(it.file!.slice(start, end));
    });

  const finish = async (key: string, videoId: string | null) => {
    patch(key, { status: 'done', videoId, error: null, retryAt: null });
    const it = find(key);
    if (it?.subtitle && videoId) {
      try {
        const fd = new FormData();
        fd.append('lang', it.subtitle.lang);
        fd.append('file', it.subtitle.file);
        await fetch(`/api/videos/${videoId}/subtitles`, { method: 'POST', body: fd, headers: { 'X-CSRF-Token': csrfToken() }, credentials: 'same-origin' });
      } catch {
        /* subtitle bisa ditambahkan nanti dari Video Anda */
      }
    }
    set((s) => ({ completed: s.completed + 1 }));
    pump();
  };

  const scheduleRetry = (key: string, err: ApiError) => {
    const it = find(key);
    if (!it) return;
    const attempts = it.attempts + 1;
    if (attempts > BACKOFF.length) {
      patch(key, { status: 'paused', error: 'Dijeda — koneksi bermasalah', attempts, retryAt: null });
      pump();
      return;
    }
    const delay = BACKOFF[attempts - 1]! * 1000;
    patch(key, { status: 'retrying', error: err.message, attempts, retryAt: Date.now() + delay });
    clearTimeout(timers.get(key));
    timers.set(
      key,
      setTimeout(() => {
        const cur = find(key);
        if (cur?.status === 'retrying') void run(key, true);
      }, delay),
    );
  };

  const run = async (key: string, syncFirst = false): Promise<void> => {
    let it = find(key);
    if (!it?.file) return;
    patch(key, { status: it.uploadId ? 'uploading' : 'starting', error: null, retryAt: null });
    try {
      let chunkSize = 16 * 1024 * 1024;
      if (!it.uploadId) {
        const init = await apiPost<ServerUpload>('/uploads', {
          fileName: it.name,
          size: it.size,
          mimeType: it.file.type,
          visibility: it.visibility,
          categoryId: it.categoryId,
        });
        chunkSize = init.chunkSize;
        patch(key, { uploadId: init.uploadId, received: 0, status: 'uploading' });
      } else if (syncFirst || it.received === 0) {
        // Sinkronkan offset dengan server/Drive sebelum melanjutkan.
        const st = await apiGet<ServerUpload>(`/uploads/${it.uploadId}`);
        chunkSize = st.chunkSize;
        if (st.status === 'completed') return finish(key, st.videoId);
        if (st.status !== 'uploading') throw new ApiError(410, 'UPLOAD_EXPIRED', st.error ?? 'Upload sudah tidak aktif. Mulai lagi.');
        patch(key, { received: st.received, status: 'uploading' });
      }
      it = find(key)!;
      let received = it.received;
      let lastT = performance.now();
      let lastB = received;
      while (received < it.size) {
        const cur = find(key);
        if (!cur || cur.status === 'cancelled') return;
        const end = Math.min(received + chunkSize, it.size);
        const base = received;
        let res: ServerUpload;
        try {
          res = await sendChunk(cur, base, end, (loaded) => {
            const now = performance.now();
            const r = base + loaded;
            if (now - lastT > 1000) {
              patch(key, { received: Math.min(r, it!.size - 1), speed: ((r - lastB) / (now - lastT)) * 1000 });
              lastT = now;
              lastB = r;
            } else {
              set((s) => ({ items: s.items.map((i) => (i.key === key ? { ...i, received: Math.min(r, it!.size - 1) } : i)) }));
            }
          });
        } catch (err) {
          if (err instanceof ApiError && err.status === 409) {
            const d = err.details as { received?: number } | undefined;
            if (typeof d?.received === 'number') {
              received = d.received;
              patch(key, { received });
              continue;
            }
          }
          throw err;
        }
        if (res.done || res.status === 'completed') return finish(key, res.videoId);
        received = res.received;
        patch(key, { received, attempts: 0 });
      }
      // Semua byte terkirim tapi respons akhir hilang → tanya status.
      const st = await apiGet<ServerUpload>(`/uploads/${it.uploadId}`);
      if (st.status === 'completed') return finish(key, st.videoId);
      throw new ApiError(502, 'INCOMPLETE', 'Menunggu konfirmasi Google Drive');
    } catch (err) {
      const e = err instanceof ApiError ? err : new ApiError(0, 'NETWORK', 'Koneksi terputus');
      if (e.code === 'ABORTED' || find(key)?.status === 'cancelled') return;
      // Kesalahan permanen: validasi, kuota, sesi kedaluwarsa, akses.
      if ((e.status >= 400 && e.status < 500 && e.status !== 408 && e.status !== 429) || e.code === 'UPLOAD_EXPIRED') {
        patch(key, { status: 'error', error: e.message, retryAt: null });
        pump();
        return;
      }
      scheduleRetry(key, e);
    }
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('online', () => get().resumePaused());
    window.addEventListener('beforeunload', (e) => {
      if (get().items.some((i) => ['starting', 'uploading', 'retrying', 'queued'].includes(i.status))) {
        e.preventDefault();
        e.returnValue = '';
      }
    });
  }

  return {
    items: [],
    panelOpen: false,
    dialogOpen: false,
    collapsed: false,
    completed: 0,
    restored: false,
    openDialog: () => set({ dialogOpen: true }),
    closeDialog: () => set({ dialogOpen: false }),
    setCollapsed: (v) => set({ collapsed: v }),
    closePanel: () => {
      if (get().items.some((i) => ['starting', 'uploading', 'retrying', 'queued'].includes(i.status))) return;
      set({ panelOpen: false, items: get().items.filter((i) => i.status === 'needs-file' || i.status === 'paused') });
      persist(get().items);
    },
    add(files, opts) {
      const items: UploadItem[] = files.map(({ file, subtitle }) => ({
        key: `u${Date.now().toString(36)}${seq++}`,
        file,
        name: file.name,
        size: file.size,
        lastModified: file.lastModified,
        visibility: opts.visibility,
        categoryId: opts.categoryId,
        subtitle: subtitle ?? null,
        uploadId: null,
        received: 0,
        status: 'queued',
        error: null,
        videoId: null,
        attempts: 0,
        retryAt: null,
        speed: null,
      }));
      set((s) => ({ items: [...s.items, ...items], panelOpen: true, collapsed: false }));
      pump();
    },
    cancel(key) {
      const it = find(key);
      if (!it) return;
      clearTimeout(timers.get(key));
      xhrs.get(key)?.abort();
      patch(key, { status: 'cancelled', error: null });
      if (it.uploadId) void apiDelete(`/uploads/${it.uploadId}`).catch(() => {});
      pump();
    },
    retry(key) {
      const it = find(key);
      if (!it?.file) return;
      patch(key, { attempts: 0, status: 'queued', error: null });
      if (it.uploadId) void run(key, true);
      else pump();
    },
    remove(key) {
      set((s) => ({ items: s.items.filter((i) => i.key !== key) }));
      persist(get().items);
    },
    provideFile(key, file) {
      const it = find(key);
      if (!it) return 'Upload tidak ditemukan';
      if (file.name !== it.name || file.size !== it.size || (it.lastModified && file.lastModified !== it.lastModified)) {
        return `Pilih file yang sama: ${it.name}`;
      }
      patch(key, { file, status: 'queued', attempts: 0, error: null });
      void run(key, true);
      return null;
    },
    async restore() {
      if (get().restored) return;
      set({ restored: true });
      const saved = storage.get<Persisted[]>(LS_KEY, []);
      if (!saved.length) return;
      let server: ServerUpload[] = [];
      try {
        server = (await apiGet<{ items: ServerUpload[] }>('/uploads')).items;
      } catch {
        return;
      }
      const alive = new Map(server.map((u) => [u.uploadId, u]));
      const items: UploadItem[] = saved
        .filter((p) => alive.has(p.uploadId) && !get().items.some((i) => i.uploadId === p.uploadId))
        .map((p) => ({
          key: `r${p.uploadId}`,
          file: null,
          name: p.name,
          size: p.size,
          lastModified: p.lastModified,
          visibility: p.visibility,
          categoryId: null,
          subtitle: null,
          uploadId: p.uploadId,
          received: alive.get(p.uploadId)!.received,
          status: 'needs-file',
          error: null,
          videoId: null,
          attempts: 0,
          retryAt: null,
          speed: null,
        }));
      if (items.length) set((s) => ({ items: [...s.items, ...items], panelOpen: true }));
      persist(get().items);
    },
    resumePaused() {
      for (const it of get().items) if ((it.status === 'paused' || it.status === 'retrying') && it.file) void run(it.key, true);
    },
  };
});

/** Batalkan semua upload berjalan saat logout (opsional dipanggil). */
export function cancelAllUploads(): void {
  for (const it of useUploads.getState().items) if (['starting', 'uploading', 'retrying', 'queued'].includes(it.status)) useUploads.getState().cancel(it.key);
}

