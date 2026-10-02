import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '../../components/ui/Button';
import { Spinner, Switch } from '../../components/ui/misc';
import { useDocumentTitle } from '../../hooks/useSite';
import { apiGet, apiPut, errorMessage } from '../../lib/api';
import { toast } from '../../stores/toast';

type Value = string | number | boolean | null | string[];
interface Field {
  key: string;
  label: string;
  help?: string;
  type: 'switch' | 'number' | 'select' | 'list' | 'quota';
  options?: [Value, string][];
  min?: number;
  max?: number;
  step?: number;
}
interface Group {
  title: string;
  subtitle: string;
  fields: Field[];
}

const GROUPS: Record<'upload' | 'player' | 'security', Group> = {
  upload: {
    title: 'Upload',
    subtitle: 'Batas dan bawaan untuk video yang diupload pengguna (file disimpan di folder Google Drive).',
    fields: [
      { key: 'enabled', label: 'Izinkan pengguna mengupload video', type: 'switch' },
      { key: 'max_file_gb', label: 'Ukuran file maksimal (GB)', type: 'number', min: 0.1, max: 100, step: 0.1 },
      {
        key: 'chunk_mb',
        label: 'Ukuran potongan upload',
        help: 'Potongan lebih kecil lebih tahan koneksi buruk; harus ≤ 64 MB (batas nginx).',
        type: 'select',
        options: [
          [8, '8 MB'],
          [16, '16 MB'],
          [32, '32 MB'],
        ],
      },
      {
        key: 'default_visibility',
        label: 'Visibilitas bawaan',
        type: 'select',
        options: [
          ['public', 'Publik'],
          ['private', 'Privat'],
        ],
      },
      { key: 'default_quota_gb', label: 'Kuota bawaan user baru (GB)', help: 'Kosongkan untuk tanpa batas.', type: 'quota', min: 0 },
      { key: 'allowed_ext', label: 'Ekstensi yang diizinkan', help: 'Pisahkan dengan koma, mis. mp4, mkv, webm', type: 'list' },
    ],
  },
  player: {
    title: 'Pemutar',
    subtitle: 'Perilaku bawaan pemutar video untuk semua pengunjung.',
    fields: [
      { key: 'autoplay_default', label: 'Putar otomatis aktif secara bawaan', help: 'Pengunjung tetap bisa mengubahnya; pilihan mereka disimpan di perangkatnya.', type: 'switch' },
      {
        key: 'seek_seconds',
        label: 'Lompatan maju/mundur (J/L & double-tap)',
        type: 'select',
        options: [
          [5, '5 detik'],
          [10, '10 detik'],
          [15, '15 detik'],
          [30, '30 detik'],
        ],
      },
      { key: 'endscreen_countdown', label: 'Hitung mundur video berikutnya (detik)', help: '0 = langsung lanjut tanpa hitung mundur.', type: 'number', min: 0, max: 20, step: 1 },
    ],
  },
  security: {
    title: 'Keamanan',
    subtitle: 'Sesi login. Batas percobaan login (10 kali gagal / 15 menit per IP & username) tidak bisa diubah di sini.',
    fields: [{ key: 'session_days', label: 'Lama sesi "Ingat saya" (hari)', type: 'number', min: 1, max: 365, step: 1 }],
  },
};

/** Halaman pengaturan generik untuk grup upload, player, security. */
export function GroupSettingsPage({ group }: { group: keyof typeof GROUPS }) {
  const def = GROUPS[group];
  useDocumentTitle(`${def.title} - Studio`);
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['admin', 'settings'], queryFn: () => apiGet<Record<string, Record<string, Value>>>('/admin/settings') });
  const [form, setForm] = useState<Record<string, Value> | null>(null);
  useEffect(() => {
    if (data) setForm({ ...data[group] });
  }, [data, group]);
  const save = useMutation({
    mutationFn: (body: Record<string, Value>) => apiPut(`/admin/settings/${group}`, body),
    onSuccess: () => {
      toast(`Pengaturan ${def.title.toLowerCase()} disimpan`);
      void qc.invalidateQueries({ queryKey: ['admin', 'settings'] });
      void qc.invalidateQueries({ queryKey: ['site'] });
    },
    onError: (e) => toast(errorMessage(e)),
  });

  if (isLoading || !form) {
    return (
      <div className="dv-studio-page">
        <Spinner />
      </div>
    );
  }
  const set = (k: string, v: Value) => setForm({ ...form, [k]: v });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const body: Record<string, Value> = {};
    for (const f of def.fields) body[f.key] = form[f.key] ?? null;
    save.mutate(body);
  };

  return (
    <div className="dv-studio-page">
      <h1 className="dv-studio-page__title">{def.title}</h1>
      <form onSubmit={submit}>
        <section className="dv-studio-card">
          <p className="dv-studio-card__subtitle">{def.subtitle}</p>
          <div className="dv-form">
            {def.fields.map((f) => (
              <div key={f.key} className="dv-setting">
                {f.type === 'switch' ? (
                  <label className="dv-row">
                    <Switch checked={Boolean(form[f.key])} onChange={(v) => set(f.key, v)} label={f.label} />
                    <span>{f.label}</span>
                  </label>
                ) : (
                  <label className="dv-setting__row">
                    <span className="dv-setting__label">{f.label}</span>
                    {f.type === 'select' ? (
                      <select
                        className="dv-select"
                        value={String(form[f.key])}
                        onChange={(e) => {
                          const opt = f.options!.find(([v]) => String(v) === e.target.value);
                          set(f.key, opt ? opt[0] : e.target.value);
                        }}
                      >
                        {f.options!.map(([v, l]) => (
                          <option key={String(v)} value={String(v)}>
                            {l}
                          </option>
                        ))}
                      </select>
                    ) : f.type === 'list' ? (
                      <input
                        className="dv-select"
                        value={(form[f.key] as string[]).join(', ')}
                        onChange={(e) =>
                          set(
                            f.key,
                            e.target.value
                              .split(',')
                              .map((x) => x.trim().toLowerCase())
                              .filter(Boolean),
                          )
                        }
                      />
                    ) : (
                      <input
                        className="dv-select"
                        type="number"
                        min={f.min}
                        max={f.max}
                        step={f.step ?? 'any'}
                        value={form[f.key] == null ? '' : String(form[f.key])}
                        placeholder={f.type === 'quota' ? 'Tanpa batas' : undefined}
                        onChange={(e) => set(f.key, e.target.value === '' ? (f.type === 'quota' ? null : 0) : Number(e.target.value))}
                      />
                    )}
                  </label>
                )}
                {f.help && <p className="dv-setting__help">{f.help}</p>}
              </div>
            ))}
          </div>
        </section>
        <div className="dv-form__actions">
          <Button type="submit" variant="primary" disabled={save.isPending}>
            Simpan
          </Button>
        </div>
      </form>
    </div>
  );
}
