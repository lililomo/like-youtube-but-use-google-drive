import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { Icon } from '../../components/icons/Icon';
import { Button } from '../../components/ui/Button';
import { Spinner, Switch, TextField } from '../../components/ui/misc';
import { useDocumentTitle } from '../../hooks/useSite';
import { apiGet, apiPost, apiPut, errorMessage } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import { toast } from '../../stores/toast';

interface DriveStatus {
  authMode: 'oauth' | 'service_account';
  configured: boolean;
  connectedEmail: string | null;
  oauth: { clientId: string; clientSecretConfigured: boolean; refreshTokenConfigured: boolean };
  serviceAccount: { configured: boolean; email: string | null };
  folder: { id: string; name: string | null } | null;
  sharedDriveId: string | null;
  systemFolderId: string | null;
  includeSubfolders: boolean;
  syncIntervalSec: number;
  fullSyncIntervalMin: number;
  lastSyncAt: string | null;
  lastFullSyncAt: string | null;
  lastSyncError: string | null;
  redirectUri: string;
}

interface FolderStats {
  folder: { id: string; name: string };
  videoCount: number;
  subfolderCount: number;
  subtitleCount: number;
  truncated: boolean;
}

const KEY = ['admin', 'drive', 'status'];

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  toast('Disalin ke papan klip');
}

function Card({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children: ReactNode }) {
  return (
    <section className="dv-studio-card">
      <h2 className="dv-studio-card__title">{title}</h2>
      {subtitle && <p className="dv-studio-card__subtitle">{subtitle}</p>}
      {children}
    </section>
  );
}

function StatsView({ stats }: { stats: FolderStats }) {
  return (
    <div className="dv-banner dv-banner--success" style={{ marginTop: 16 }}>
      <Icon name="check-circle" />
      <div>
        Folder <b>{stats.folder.name}</b>: {stats.videoCount.toLocaleString('id-ID')} video, {stats.subfolderCount.toLocaleString('id-ID')} subfolder,{' '}
        {stats.subtitleCount.toLocaleString('id-ID')} subtitle{stats.truncated ? ' (dihitung sebagian — folder sangat besar)' : ''}.
      </div>
    </div>
  );
}

function Guide({ redirectUri, open }: { redirectUri: string; open: boolean }) {
  return (
    <details className="dv-details" open={open}>
      <summary>
        <Icon name="expand-more" /> Panduan membuat kredensial (±5 menit)
      </summary>
      <ol className="dv-steps">
        <li>
          Buka{' '}
          <a className="dv-link" href="https://console.cloud.google.com/projectcreate" target="_blank" rel="noreferrer">
            Google Cloud Console
          </a>{' '}
          dan buat project baru (mis. "Dymas Video"), memakai akun Google <b>pemilik folder video</b>.
        </li>
        <li>
          Buka{' '}
          <a className="dv-link" href="https://console.cloud.google.com/apis/library/drive.googleapis.com" target="_blank" rel="noreferrer">
            APIs &amp; Services → Library → Google Drive API
          </a>{' '}
          lalu klik <b>Enable</b>.
        </li>
        <li>
          Buka{' '}
          <a className="dv-link" href="https://console.cloud.google.com/auth/branding" target="_blank" rel="noreferrer">
            Google Auth Platform (OAuth consent screen)
          </a>
          : isi nama aplikasi &amp; email, tipe audiens <b>External</b>. Di <b>Data access</b> tambahkan scope <code>.../auth/drive</code>.
        </li>
        <li>
          Di menu <b>Audience</b>, klik <b>Publish app</b> sehingga status menjadi <b>In production</b>. Ini wajib — bila masih <i>Testing</i>, token
          kedaluwarsa setiap 7 hari.
        </li>
        <li>
          Buka{' '}
          <a className="dv-link" href="https://console.cloud.google.com/auth/clients" target="_blank" rel="noreferrer">
            Clients → Create client
          </a>
          , pilih <b>Web application</b>, lalu isi <b>Authorized redirect URIs</b> dengan:
          <div className="dv-copy-row" style={{ marginTop: 8 }}>
            <span>{redirectUri}</span>
            <Button size="sm" variant="text" icon="copy" onClick={() => copy(redirectUri)}>
              Salin
            </Button>
          </div>
        </li>
        <li>Salin <b>Client ID</b> dan <b>Client Secret</b> ke form di bawah, klik <b>Simpan kredensial</b>.</li>
        <li>
          Klik <b>Hubungkan Google Drive</b>, pilih akun pemilik folder. Bila muncul "Google hasn't verified this app", klik <b>Advanced → Go to … (unsafe)</b>, lalu
          izinkan akses.
        </li>
        <li>Tempel URL folder video di bagian <b>Folder sumber</b> lalu klik <b>Simpan folder</b>.</li>
      </ol>
    </details>
  );
}

export function DriveSettingsPage() {
  useDocumentTitle('Google Drive - Studio');
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const { data: status, isLoading, error } = useQuery({ queryKey: KEY, queryFn: () => apiGet<DriveStatus>('/admin/drive/status') });
  const [callbackError, setCallbackError] = useState<string | null>(null);

  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [saJson, setSaJson] = useState('');
  const [folderInput, setFolderInput] = useState('');
  const [stats, setStats] = useState<FolderStats | null>(null);
  const [testAccount, setTestAccount] = useState<string | null>(null);
  const [opts, setOpts] = useState({ include_subfolders: true, sync_interval_sec: 60, full_sync_interval_min: 360 });

  useEffect(() => {
    if (params.get('connected')) {
      toast('Google Drive berhasil terhubung');
      setParams({}, { replace: true });
    } else if (params.get('error')) {
      setCallbackError(params.get('error'));
      setParams({}, { replace: true });
    }
  }, [params, setParams]);

  useEffect(() => {
    if (!status) return;
    setClientId(status.oauth.clientId);
    setFolderInput((v) => v || (status.folder ? `https://drive.google.com/drive/folders/${status.folder.id}` : ''));
    setOpts({
      include_subfolders: status.includeSubfolders,
      sync_interval_sec: status.syncIntervalSec,
      full_sync_interval_min: status.fullSyncIntervalMin,
    });
  }, [status]);

  const refresh = () => qc.invalidateQueries({ queryKey: KEY });
  const onError = (err: unknown) => toast(errorMessage(err));

  const saveSettings = useMutation({
    mutationFn: (body: Record<string, unknown>) => apiPut('/admin/settings/drive', body),
    onSuccess: () => {
      toast('Pengaturan disimpan');
      setClientSecret('');
      void refresh();
    },
    onError,
  });
  const connect = useMutation({
    mutationFn: () => apiPost<{ authUrl: string }>('/admin/drive/oauth/start'),
    onSuccess: (res) => {
      window.location.href = res.authUrl;
    },
    onError,
  });
  const disconnect = useMutation({
    mutationFn: () => apiPost('/admin/drive/disconnect'),
    onSuccess: () => {
      toast('Google Drive diputuskan');
      void refresh();
    },
    onError,
  });
  const saveSa = useMutation({
    mutationFn: () => apiPost('/admin/drive/service-account', { json: saJson }),
    onSuccess: () => {
      toast('Service Account disimpan & diverifikasi');
      setSaJson('');
      void refresh();
    },
    onError,
  });
  const testFolder = useMutation({
    mutationFn: (folder?: string) => apiPost<{ ok: boolean; account: string | null; stats: FolderStats | null }>('/admin/drive/test', folder ? { folder } : {}),
    onSuccess: (res) => {
      setStats(res.stats);
      setTestAccount(res.account);
      toast(res.stats ? 'Koneksi & folder OK' : 'Koneksi Google Drive OK');
    },
    onError: (err) => {
      setStats(null);
      onError(err);
    },
  });
  const saveFolder = useMutation({
    mutationFn: () => apiPost<{ folder: { id: string; name: string }; changed: boolean }>('/admin/drive/folder', { folder: folderInput }),
    onSuccess: (res) => {
      toast(`Folder "${res.folder.name}" disimpan`);
      void refresh();
    },
    onError,
  });

  if (isLoading) {
    return (
      <div className="dv-studio-page">
        <Spinner />
      </div>
    );
  }
  if (error || !status) {
    return (
      <div className="dv-studio-page">
        <div className="dv-banner dv-banner--error">{errorMessage(error)}</div>
      </div>
    );
  }

  const oauthReady = Boolean(status.oauth.clientId) && status.oauth.clientSecretConfigured;
  const connected = status.configured;
  const stateLabel = connected
    ? status.folder
      ? 'Terhubung'
      : 'Terhubung — folder belum dipilih'
    : status.authMode === 'oauth' && oauthReady
      ? 'Kredensial tersimpan — belum dihubungkan'
      : 'Belum terhubung';

  return (
    <div className="dv-studio-page">
      <h1 className="dv-studio-page__title">Google Drive</h1>

      {callbackError && (
        <div className="dv-banner dv-banner--error" style={{ marginBottom: 16 }}>
          <Icon name="error" />
          <div>{callbackError}</div>
        </div>
      )}

      <Card title="Status koneksi">
        <dl className="dv-kv">
          <dt>Status</dt>
          <dd>
            <span className={`dv-status-dot dv-status-dot--${connected && status.folder ? 'ok' : connected ? 'idle' : 'bad'}`} />
            {stateLabel}
          </dd>
          <dt>Mode</dt>
          <dd>{status.authMode === 'oauth' ? 'OAuth (akun Google)' : 'Service Account (Shared Drive)'}</dd>
          <dt>Akun</dt>
          <dd>{status.connectedEmail ?? '—'}</dd>
          <dt>Folder sumber</dt>
          <dd>
            {status.folder ? (
              <a className="dv-link" href={`https://drive.google.com/drive/folders/${status.folder.id}`} target="_blank" rel="noreferrer">
                {status.folder.name ?? status.folder.id}
              </a>
            ) : (
              '—'
            )}
            {status.sharedDriveId && ' (Shared Drive)'}
          </dd>
          <dt>Sinkron terakhir</dt>
          <dd>{status.lastSyncAt ? formatDateTime(status.lastSyncAt) : '—'}</dd>
        </dl>
        {status.lastSyncError && (
          <div className="dv-banner dv-banner--error" style={{ marginTop: 16 }}>
            <Icon name="error" />
            <div>{status.lastSyncError}</div>
          </div>
        )}
        <div className="dv-row" style={{ marginTop: 16 }}>
          <Button variant="tonal" icon="refresh" disabled={!connected || testFolder.isPending} onClick={() => testFolder.mutate(undefined)}>
            {testFolder.isPending ? 'Menguji…' : 'Tes koneksi'}
          </Button>
          {testAccount && !testFolder.isPending && <span className="dv-text-secondary">Akun: {testAccount}</span>}
        </div>
        {stats && <StatsView stats={stats} />}
      </Card>

      <Card
        title="Metode autentikasi"
        subtitle="API key biasa tidak cukup: API key hanya bisa membaca file yang dibagikan publik dan tidak bisa mengupload. Karena itu dipakai OAuth (akun Google Anda) atau Service Account."
      >
        <div className="dv-radio-group">
          <label className="dv-radio">
            <input
              type="radio"
              name="mode"
              checked={status.authMode === 'oauth'}
              onChange={() => saveSettings.mutate({ auth_mode: 'oauth' })}
            />
            <span>
              <span className="dv-radio__title">OAuth — akun Google (disarankan)</span>
              <br />
              <span className="dv-radio__desc">Untuk folder di "My Drive" akun Google biasa maupun Workspace.</span>
            </span>
          </label>
          <label className="dv-radio">
            <input
              type="radio"
              name="mode"
              checked={status.authMode === 'service_account'}
              onChange={() => saveSettings.mutate({ auth_mode: 'service_account' })}
            />
            <span>
              <span className="dv-radio__title">Service Account</span>
              <br />
              <span className="dv-radio__desc">Hanya untuk folder di Shared Drive (Google Workspace). Service Account tidak punya kuota penyimpanan di My Drive.</span>
            </span>
          </label>
        </div>
      </Card>

      {status.authMode === 'oauth' ? (
        <Card title="Kredensial OAuth" subtitle="Buat OAuth Client (Web application) di Google Cloud Console, lalu hubungkan akun Google pemilik folder.">
          <Guide redirectUri={status.redirectUri} open={!status.oauth.refreshTokenConfigured} />
          <form
            className="dv-form"
            style={{ marginTop: 16 }}
            onSubmit={(e) => {
              e.preventDefault();
              const body: Record<string, unknown> = { oauth_client_id: clientId.trim() };
              if (clientSecret.trim()) body.oauth_client_secret = clientSecret.trim();
              saveSettings.mutate(body);
            }}
          >
            <div>
              <div className="dv-form__label">Redirect URI</div>
              <div className="dv-copy-row">
                <span>{status.redirectUri}</span>
                <Button size="sm" variant="text" icon="copy" onClick={() => copy(status.redirectUri)}>
                  Salin
                </Button>
              </div>
            </div>
            <TextField label="Client ID" value={clientId} onChange={(e) => setClientId(e.target.value)} autoComplete="off" spellCheck={false} />
            <TextField
              label={status.oauth.clientSecretConfigured ? 'Client Secret (tersimpan — isi untuk mengganti)' : 'Client Secret'}
              type="password"
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
              autoComplete="new-password"
              helper={status.oauth.clientSecretConfigured ? 'Tersimpan •••• (terenkripsi). Kosongkan bila tidak diubah.' : undefined}
            />
            <p className="dv-text-secondary" style={{ fontSize: '1.3rem' }}>
              Mengganti Client ID/Secret akan memutus koneksi; Anda perlu menekan "Hubungkan Google Drive" lagi.
            </p>
            <div className="dv-form__actions">
              <Button type="submit" variant="tonal" disabled={saveSettings.isPending || !clientId.trim() || (!status.oauth.clientSecretConfigured && !clientSecret.trim())}>
                Simpan kredensial
              </Button>
            </div>
          </form>
          <div className="dv-row dv-row--between" style={{ marginTop: 16, borderTop: '1px solid var(--divider)', paddingTop: 16 }}>
            <div>
              {status.oauth.refreshTokenConfigured ? (
                <>
                  <span className="dv-status-dot dv-status-dot--ok" />
                  Terhubung sebagai <b>{status.connectedEmail ?? 'akun Google'}</b>
                </>
              ) : (
                <span className="dv-text-secondary">Belum ada akun Google yang terhubung.</span>
              )}
            </div>
            <div className="dv-row">
              {status.oauth.refreshTokenConfigured && (
                <Button variant="text" disabled={disconnect.isPending} onClick={() => confirm('Putuskan koneksi Google Drive?') && disconnect.mutate()}>
                  Putuskan
                </Button>
              )}
              <Button variant="primary" icon="link" disabled={!oauthReady || connect.isPending} onClick={() => connect.mutate()}>
                {status.oauth.refreshTokenConfigured ? 'Hubungkan ulang' : 'Hubungkan Google Drive'}
              </Button>
            </div>
          </div>
        </Card>
      ) : (
        <Card
          title="Service Account"
          subtitle="Tempel isi file kunci JSON Service Account. Tambahkan email Service Account sebagai anggota (Content manager) di Shared Drive yang berisi folder video."
        >
          {status.serviceAccount.email && (
            <div className="dv-copy-row" style={{ marginBottom: 16 }}>
              <span>{status.serviceAccount.email}</span>
              <Button size="sm" variant="text" icon="copy" onClick={() => copy(status.serviceAccount.email!)}>
                Salin
              </Button>
            </div>
          )}
          <form
            className="dv-form"
            onSubmit={(e) => {
              e.preventDefault();
              saveSa.mutate();
            }}
          >
            <textarea
              className="dv-textarea"
              rows={6}
              placeholder={status.serviceAccount.configured ? 'Tersimpan (terenkripsi). Tempel JSON baru untuk mengganti.' : '{ "type": "service_account", ... }'}
              value={saJson}
              onChange={(e) => setSaJson(e.target.value)}
              spellCheck={false}
            />
            <div className="dv-row dv-row--between">
              <label className="dv-btn dv-btn--text dv-btn--with-icon" style={{ cursor: 'pointer' }}>
                <Icon name="upload-outline" />
                <span className="dv-btn__label">Pilih file .json</span>
                <input
                  type="file"
                  accept="application/json,.json"
                  hidden
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (f) setSaJson(await f.text());
                  }}
                />
              </label>
              <Button type="submit" variant="tonal" disabled={!saJson.trim() || saveSa.isPending}>
                {saveSa.isPending ? 'Memverifikasi…' : 'Simpan & verifikasi'}
              </Button>
            </div>
          </form>
        </Card>
      )}

      <Card title="Folder sumber" subtitle="Semua video di folder ini (dan subfolder) akan tampil di situs. Upload user juga masuk ke folder ini.">
        <form
          className="dv-form"
          onSubmit={(e) => {
            e.preventDefault();
            saveFolder.mutate();
          }}
        >
          <TextField
            label="URL atau ID folder Google Drive"
            value={folderInput}
            onChange={(e) => setFolderInput(e.target.value)}
            spellCheck={false}
            helper="Contoh: https://drive.google.com/drive/folders/1AbC…"
          />
          <div className="dv-form__actions">
            <Button variant="text" disabled={!connected || !folderInput.trim() || testFolder.isPending} onClick={() => testFolder.mutate(folderInput)}>
              {testFolder.isPending ? 'Menguji…' : 'Tes folder'}
            </Button>
            <Button type="submit" variant="tonal" disabled={!connected || !folderInput.trim() || saveFolder.isPending}>
              {saveFolder.isPending ? 'Menyimpan…' : 'Simpan folder'}
            </Button>
          </div>
        </form>
        {!connected && <p className="dv-text-secondary">Hubungkan Google Drive terlebih dahulu.</p>}
      </Card>

      <Card title="Opsi sinkronisasi">
        <form
          className="dv-form"
          onSubmit={(e) => {
            e.preventDefault();
            saveSettings.mutate(opts);
          }}
        >
          <label className="dv-row">
            <Switch checked={opts.include_subfolders} onChange={(v) => setOpts({ ...opts, include_subfolders: v })} label="Sertakan subfolder" />
            <span>Sertakan subfolder (subfolder menjadi kategori)</span>
          </label>
          <label className="dv-row">
            <span style={{ minWidth: 220 }}>Cek perubahan Drive setiap</span>
            <select
              className="dv-select"
              style={{ width: 200 }}
              value={opts.sync_interval_sec}
              onChange={(e) => setOpts({ ...opts, sync_interval_sec: Number(e.target.value) })}
            >
              {[30, 60, 120, 300, 600].map((s) => (
                <option key={s} value={s}>
                  {s < 60 ? `${s} detik` : `${s / 60} menit`}
                </option>
              ))}
            </select>
          </label>
          <label className="dv-row">
            <span style={{ minWidth: 220 }}>Sinkronisasi penuh setiap</span>
            <select
              className="dv-select"
              style={{ width: 200 }}
              value={opts.full_sync_interval_min}
              onChange={(e) => setOpts({ ...opts, full_sync_interval_min: Number(e.target.value) })}
            >
              {[60, 180, 360, 720, 1440].map((m) => (
                <option key={m} value={m}>
                  {m / 60} jam
                </option>
              ))}
            </select>
          </label>
          <div className="dv-form__actions">
            <Button type="submit" variant="tonal" disabled={saveSettings.isPending}>
              Simpan opsi
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
