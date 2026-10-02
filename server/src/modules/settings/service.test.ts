import { describe, expect, it } from 'vitest';
import { SettingsService, type SettingsRow, type SettingsStore } from './service.js';

function memoryStore(initial: SettingsRow[] = []): SettingsStore & { rows: Map<string, SettingsRow> } {
  const rows = new Map(initial.map((r) => [r.key, r]));
  return {
    rows,
    async loadAll() {
      return [...rows.values()];
    },
    async upsert(list) {
      for (const r of list) rows.set(r.key, r);
    },
  };
}

describe('SettingsService', () => {
  it('mengembalikan default bila belum diset', async () => {
    const s = new SettingsService(memoryStore());
    await s.load();
    expect(s.get('site.name')).toBe('GDrive Tube');
    expect(s.get('processing.renditions')).toEqual([720, 360]);
    expect(s.get('drive.root_folder_id')).toBeNull();
    expect(s.getSecret('drive.oauth_client_secret')).toBe('');
  });

  it('set → get & persist (JSON)', async () => {
    const store = memoryStore();
    const s = new SettingsService(store);
    await s.load();
    await s.set({ 'site.name': 'Video Saya', 'processing.renditions': [1080, 480] });
    expect(s.get('site.name')).toBe('Video Saya');
    const s2 = new SettingsService(store);
    await s2.load();
    expect(s2.get('processing.renditions')).toEqual([1080, 480]);
    expect(store.rows.get('site.name')?.value).toBe('"Video Saya"');
  });

  it('rahasia dienkripsi, dimasking, dan bisa dihapus', async () => {
    const store = memoryStore();
    const s = new SettingsService(store);
    await s.load();
    await s.set({ 'drive.oauth_client_secret': 'GOCSPX-rahasia' });
    const raw = store.rows.get('drive.oauth_client_secret')!;
    expect(raw.is_secret).toBe(1);
    expect(raw.value).not.toContain('GOCSPX');
    expect(s.getSecret('drive.oauth_client_secret')).toBe('GOCSPX-rahasia');
    expect(() => s.get('drive.oauth_client_secret')).toThrow();

    const group = s.group('drive');
    expect(group.oauth_client_secret).toEqual({ configured: true });
    expect(group.oauth_refresh_token).toEqual({ configured: false });
    expect(JSON.stringify(group)).not.toContain('GOCSPX');

    await s.set({ 'drive.oauth_client_secret': '' });
    expect(s.hasSecret('drive.oauth_client_secret')).toBe(false);
  });

  it('menolak kunci tidak dikenal & mengabaikan baris DB asing', async () => {
    const s = new SettingsService(
      memoryStore([{ key: 'unknown.key', value: '1', is_secret: 0 }, { key: 'site.name', value: '{rusak', is_secret: 0 }]),
    );
    await s.load();
    expect(s.get('site.name')).toBe('GDrive Tube');
    // @ts-expect-error kunci tidak dikenal
    await expect(s.set({ 'foo.bar': 1 })).rejects.toThrow();
  });

  it('group hanya berisi kunci prefix tersebut', async () => {
    const s = new SettingsService(memoryStore());
    await s.load();
    const site = s.group('site');
    expect(Object.keys(site)).toContain('name');
    expect(Object.keys(site)).not.toContain('root_folder_id');
  });
});
