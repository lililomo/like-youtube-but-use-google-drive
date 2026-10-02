import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { LogoContent } from '../../components/layout/Logo';
import { Button } from '../../components/ui/Button';
import { Spinner, Switch, TextField } from '../../components/ui/misc';
import { setSiteCache, useDocumentTitle, useSite, type SiteInfo } from '../../hooks/useSite';
import { apiDelete, apiGet, apiPut, apiPutFile, errorMessage } from '../../lib/api';
import { toast } from '../../stores/toast';

interface SiteForm {
  name: string;
  channel_name: string;
  channel_handle: string;
  default_theme: 'system' | 'dark' | 'light';
  guest_playlists: boolean;
  logo_mode: 'icon' | 'full';
}

type Slot = 'logo' | 'logo_dark' | 'favicon';
const IMAGE_ACCEPT = 'image/png,image/svg+xml,image/webp,image/jpeg,image/gif,image/avif';
const IMAGE_MAX = 5 * 1024 * 1024;

/** Kartu unggah satu gambar branding (logo / logo gelap / favicon). */
function ImageSlot({
  title,
  hint,
  url,
  busy,
  onUpload,
  onRemove,
  square,
}: {
  title: string;
  hint: string;
  url: string | null;
  busy: boolean;
  onUpload: (file: File) => void;
  onRemove: () => void;
  square?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const pick = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > IMAGE_MAX) {
      toast('Ukuran gambar maksimal 5 MB');
      return;
    }
    onUpload(file);
  };
  return (
    <div className="dv-brand-slot">
      <div className={`dv-brand-slot__preview${square ? ' is-square' : ''}`}>
        {url ? <img src={url} alt="" /> : <span className="dv-text-secondary">Bawaan</span>}
      </div>
      <div className="dv-brand-slot__body">
        <div className="dv-brand-slot__title">{title}</div>
        <p className="dv-text-secondary">{hint}</p>
        <div className="dv-row">
          <Button size="sm" disabled={busy} onClick={() => input.current?.click()}>
            {url ? 'Ganti' : 'Upload'}
          </Button>
          {url && (
            <Button size="sm" variant="text" disabled={busy} onClick={onRemove}>
              Hapus
            </Button>
          )}
        </div>
        <input ref={input} type="file" accept={IMAGE_ACCEPT} hidden onChange={pick} />
      </div>
    </div>
  );
}

/** Studio → Pengaturan → Situs: nama aplikasi, logo, favicon, channel utama, tema default. */
export function SiteSettingsPage() {
  useDocumentTitle('Situs - Studio');
  const qc = useQueryClient();
  const site = useSite();
  const { data, isLoading } = useQuery({ queryKey: ['admin', 'settings'], queryFn: () => apiGet<{ site: SiteForm }>('/admin/settings') });
  const [form, setForm] = useState<SiteForm | null>(null);
  const [busy, setBusy] = useState<Slot | null>(null);

  useEffect(() => {
    if (data) setForm(data.site);
  }, [data]);

  const save = useMutation({
    mutationFn: (body: Partial<SiteForm>) => apiPut<{ site: SiteForm }>('/admin/settings/site', body),
    onSuccess: (res) => {
      toast('Pengaturan situs disimpan');
      setForm(res.site);
      void qc.invalidateQueries({ queryKey: ['admin', 'settings'] });
      void qc.invalidateQueries({ queryKey: ['site'] });
    },
    onError: (e) => toast(errorMessage(e)),
  });

  const upload = async (slot: Slot, file: File) => {
    setBusy(slot);
    try {
      const res = await apiPutFile<{ site: SiteInfo }>(`/admin/branding/${slot}`, file);
      setSiteCache(qc, res.site);
      if (form && slot === 'logo') setForm({ ...form, logo_mode: res.site.logoMode });
      toast('Gambar disimpan');
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  const remove = async (slot: Slot) => {
    setBusy(slot);
    try {
      const res = await apiDelete<{ site: SiteInfo }>(`/admin/branding/${slot}`);
      setSiteCache(qc, res.site);
      toast('Gambar dihapus, kembali ke bawaan');
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  if (isLoading || !form) {
    return (
      <div className="dv-studio-page">
        <Spinner />
      </div>
    );
  }
  const set = <K extends keyof SiteForm>(k: K, v: SiteForm[K]) => setForm({ ...form, [k]: v });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate({
      name: form.name.trim(),
      channel_name: form.channel_name.trim(),
      channel_handle: form.channel_handle.trim(),
      default_theme: form.default_theme,
      guest_playlists: form.guest_playlists,
      logo_mode: form.logo_mode,
    });
  };
  // Pratinjau memakai nilai form yang belum disimpan.
  const preview: SiteInfo = { ...site, name: form.name.trim() || site.name, logoMode: form.logo_mode };

  return (
    <div className="dv-studio-page">
      <h1 className="dv-studio-page__title">Situs</h1>
      <form onSubmit={submit}>
        <section className="dv-studio-card">
          <h2 className="dv-studio-card__title">Nama aplikasi</h2>
          <p className="dv-studio-card__subtitle">
            Tampil di logo, judul tab browser, halaman login, dan tautan yang dibagikan. Bawaan: <b>GDrive Tube</b>.
          </p>
          <div className="dv-form">
            <TextField label="Nama aplikasi" value={form.name} maxLength={60} onChange={(e) => set('name', e.target.value)} />
          </div>
        </section>

        <section className="dv-studio-card">
          <h2 className="dv-studio-card__title">Logo & ikon</h2>
          <p className="dv-studio-card__subtitle">
            Gambar diubah otomatis menjadi PNG (SVG juga di-render ulang demi keamanan). Kosongkan untuk memakai logo bawaan (ikon merah + nama aplikasi).
          </p>
          <div className="dv-brand-preview">
            <div className="dv-brand-preview__item" data-theme-preview="light">
              <span className="dv-logo">
                <LogoContent site={{ ...preview, logoDarkUrl: null }} />
              </span>
            </div>
            <div className="dv-brand-preview__item is-dark" data-theme-preview="dark">
              <span className="dv-logo">
                <LogoContent site={{ ...preview, logoUrl: preview.logoDarkUrl ?? preview.logoUrl, logoDarkUrl: null }} />
              </span>
            </div>
          </div>
          <div className="dv-form">
            <ImageSlot
              title="Logo"
              hint="Gambar persegi = ikon di samping nama aplikasi. Gambar lebar = logo lengkap (nama tidak ditulis ulang)."
              url={site.logoUrl}
              busy={busy === 'logo'}
              onUpload={(f) => void upload('logo', f)}
              onRemove={() => void remove('logo')}
            />
            {site.logoUrl && (
              <label className="dv-row">
                <span style={{ minWidth: 220 }}>Cara menampilkan logo</span>
                <select className="dv-select" style={{ width: 280 }} value={form.logo_mode} onChange={(e) => set('logo_mode', e.target.value as SiteForm['logo_mode'])}>
                  <option value="icon">Ikon + nama aplikasi</option>
                  <option value="full">Gambar saja (logo lengkap)</option>
                </select>
              </label>
            )}
            <ImageSlot
              title="Logo untuk tema gelap (opsional)"
              hint="Dipakai saat tema gelap aktif, mis. versi logo dengan tulisan putih."
              url={site.logoDarkUrl}
              busy={busy === 'logo_dark'}
              onUpload={(f) => void upload('logo_dark', f)}
              onRemove={() => void remove('logo_dark')}
            />
            <ImageSlot
              title="Favicon"
              hint="Ikon di tab browser & layar utama HP. Gunakan gambar persegi; juga dipakai sebagai foto channel utama."
              url={site.faviconUrl}
              busy={busy === 'favicon'}
              onUpload={(f) => void upload('favicon', f)}
              onRemove={() => void remove('favicon')}
              square
            />
          </div>
        </section>

        <section className="dv-studio-card">
          <h2 className="dv-studio-card__title">Channel utama</h2>
          <p className="dv-studio-card__subtitle">Video dari folder Google Drive (tanpa pemilik) tampil atas nama channel ini.</p>
          <div className="dv-form">
            <TextField label="Nama channel" value={form.channel_name} maxLength={60} onChange={(e) => set('channel_name', e.target.value)} />
            <TextField
              label="Handle channel"
              value={form.channel_handle}
              maxLength={32}
              onChange={(e) => set('channel_handle', e.target.value.toLowerCase())}
              helper={`Alamat channel: /@${form.channel_handle || '…'} — mengubahnya membuat tautan lama tidak berlaku.`}
            />
          </div>
        </section>

        <section className="dv-studio-card">
          <h2 className="dv-studio-card__title">Lainnya</h2>
          <div className="dv-form">
            <label className="dv-row">
              <span style={{ minWidth: 220 }}>Tema bawaan</span>
              <select className="dv-select" style={{ width: 200 }} value={form.default_theme} onChange={(e) => set('default_theme', e.target.value as SiteForm['default_theme'])}>
                <option value="system">Ikuti perangkat</option>
                <option value="dark">Gelap</option>
                <option value="light">Terang</option>
              </select>
            </label>
            <label className="dv-row">
              <Switch checked={form.guest_playlists} onChange={(v) => set('guest_playlists', v)} label="Playlist tamu" />
              <span>Izinkan tamu (tanpa login) membuat playlist di perangkatnya</span>
            </label>
          </div>
        </section>

        <div className="dv-form__actions">
          <Button type="submit" variant="primary" disabled={save.isPending || !form.name.trim()}>
            Simpan
          </Button>
        </div>
      </form>
    </div>
  );
}
