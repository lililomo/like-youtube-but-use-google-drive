import { decrypt, encrypt } from '../../lib/crypto.js';
import { exec, query } from '../../db.js';

/** Nilai default semua pengaturan (SPEC §5.2). Kunci di SECRET_KEYS disimpan terenkripsi. */
export const SETTING_DEFAULTS = {
  'site.name': 'GDrive Tube',
  'site.logo_url': null as string | null,
  'site.logo_dark_url': null as string | null,
  'site.logo_mode': 'icon' as 'icon' | 'full',
  'site.favicon_url': null as string | null,
  'site.touch_icon_url': null as string | null,
  'site.channel_name': 'GDrive Tube',
  'site.channel_handle': 'gdrivetube',
  'site.default_theme': 'system' as 'system' | 'dark' | 'light',
  'site.guest_playlists': true,

  'drive.auth_mode': 'oauth' as 'oauth' | 'service_account',
  'drive.oauth_client_id': '',
  'drive.oauth_client_secret': '',
  'drive.oauth_refresh_token': '',
  'drive.connected_email': null as string | null,
  'drive.service_account_json': '',
  'drive.service_account_email': null as string | null,
  'drive.shared_drive_id': null as string | null,
  'drive.root_folder_id': null as string | null,
  'drive.root_folder_name': null as string | null,
  'drive.system_folder_id': null as string | null,
  'drive.renditions_folder_id': null as string | null,
  'drive.include_subfolders': true,
  'drive.sync_interval_sec': 60,
  'drive.full_sync_interval_min': 360,
  'drive.changes_page_token': null as string | null,
  'drive.last_sync_at': null as string | null,
  'drive.last_full_sync_at': null as string | null,
  'drive.last_sync_error': null as string | null,

  'processing.enabled': true,
  'processing.renditions': [720, 360] as number[],
  'processing.compat_max_height': 1080,
  'processing.storyboard': true,
  /** File asli MP4/MOV dengan indeks (moov) di akhir dirapikan tanpa encode ulang lalu menimpa file di Drive. */
  'processing.faststart_original': true,
  'processing.x264_preset': 'veryfast',
  'processing.threads': 3,
  'processing.nice': 15,
  'processing.min_free_disk_gb': 5,

  'upload.enabled': true,
  'upload.max_file_gb': 10,
  'upload.allowed_ext': [
    'mp4', 'm4v', 'mov', 'mkv', 'webm', 'avi', 'wmv', 'flv', 'ts', 'mts', 'm2ts', '3gp', 'mpg', 'mpeg', 'ogv',
  ] as string[],
  'upload.chunk_mb': 16,
  'upload.default_visibility': 'public' as 'public' | 'private',
  'upload.default_quota_gb': null as number | null,

  'player.autoplay_default': true,
  'player.seek_seconds': 10,
  'player.endscreen_countdown': 5,

  'security.session_days': 30,
};

export type Settings = typeof SETTING_DEFAULTS;
export type SettingKey = keyof Settings;

export const SECRET_KEYS: ReadonlySet<SettingKey> = new Set<SettingKey>([
  'drive.oauth_client_secret',
  'drive.oauth_refresh_token',
  'drive.service_account_json',
]);

export type SecretKey = 'drive.oauth_client_secret' | 'drive.oauth_refresh_token' | 'drive.service_account_json';

export const isSettingKey = (key: string): key is SettingKey => Object.hasOwn(SETTING_DEFAULTS, key);

export interface SettingsRow {
  key: string;
  value: string;
  is_secret: number;
}

export interface SettingsStore {
  loadAll(): Promise<SettingsRow[]>;
  upsert(rows: SettingsRow[]): Promise<void>;
}

export const dbSettingsStore: SettingsStore = {
  async loadAll() {
    return query<SettingsRow>('SELECT `key`, `value`, is_secret FROM settings');
  },
  async upsert(rows) {
    for (const r of rows) {
      await exec(
        'INSERT INTO settings (`key`, `value`, is_secret) VALUES (?, ?, ?) ' +
          'ON DUPLICATE KEY UPDATE `value` = VALUES(`value`), is_secret = VALUES(is_secret)',
        [r.key, r.value, r.is_secret],
      );
    }
  },
};

/** Nilai rahasia tidak pernah dikirim ke klien; hanya status terisi/tidak. */
export type MaskedSecret = { configured: boolean };

/**
 * Cache in-memory pengaturan (satu proses → cukup diinvalidasi saat set()).
 * Rahasia disimpan sebagai ciphertext di cache & DB, didekripsi hanya lewat getSecret().
 */
export class SettingsService {
  private values = new Map<SettingKey, unknown>();
  private secrets = new Map<SettingKey, string>();
  private loaded = false;

  constructor(private readonly store: SettingsStore) {}

  async load(): Promise<void> {
    const rows = await this.store.loadAll();
    this.values.clear();
    this.secrets.clear();
    for (const row of rows) {
      if (!isSettingKey(row.key)) continue;
      if (SECRET_KEYS.has(row.key)) {
        this.secrets.set(row.key, row.value);
      } else {
        try {
          this.values.set(row.key, JSON.parse(row.value));
        } catch {
          // nilai rusak → pakai default
        }
      }
    }
    this.loaded = true;
  }

  get isLoaded(): boolean {
    return this.loaded;
  }

  get<K extends SettingKey>(key: K): Settings[K] {
    if (SECRET_KEYS.has(key)) throw new Error(`gunakan getSecret() untuk ${key}`);
    return (this.values.has(key) ? this.values.get(key) : SETTING_DEFAULTS[key]) as Settings[K];
  }

  getSecret(key: SecretKey): string {
    const ct = this.secrets.get(key);
    if (!ct) return '';
    return decrypt(ct);
  }

  hasSecret(key: SecretKey): boolean {
    return Boolean(this.secrets.get(key));
  }

  /** Simpan beberapa nilai sekaligus. Rahasia: string kosong = hapus. */
  async set(values: Partial<{ [K in SettingKey]: Settings[K] }>): Promise<void> {
    const rows: SettingsRow[] = [];
    for (const [key, value] of Object.entries(values)) {
      if (!isSettingKey(key)) throw new Error(`kunci pengaturan tidak dikenal: ${key}`);
      if (SECRET_KEYS.has(key)) {
        const plain = typeof value === 'string' ? value : '';
        rows.push({ key, value: plain ? encrypt(plain) : '', is_secret: 1 });
      } else {
        rows.push({ key, value: JSON.stringify(value ?? null), is_secret: 0 });
      }
    }
    await this.store.upsert(rows);
    for (const row of rows) {
      const key = row.key as SettingKey;
      if (row.is_secret) this.secrets.set(key, row.value);
      else this.values.set(key, JSON.parse(row.value));
    }
  }

  /** Semua pengaturan dengan prefix grup ("drive" → drive.*), rahasia dimasking. */
  group(prefix: string): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(SETTING_DEFAULTS) as SettingKey[]) {
      if (!key.startsWith(`${prefix}.`)) continue;
      const name = key.slice(prefix.length + 1);
      out[name] = SECRET_KEYS.has(key)
        ? ({ configured: Boolean(this.secrets.get(key)) } satisfies MaskedSecret)
        : this.get(key);
    }
    return out;
  }
}

export const settings = new SettingsService(dbSettingsStore);
