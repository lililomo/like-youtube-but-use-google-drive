import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '../../components/ui/Button';
import { Checkbox, Spinner, Switch } from '../../components/ui/misc';
import { useDocumentTitle } from '../../hooks/useSite';
import { apiGet, apiPut, errorMessage } from '../../lib/api';
import { toast } from '../../stores/toast';

interface Processing {
  enabled: boolean;
  renditions: number[];
  compat_max_height: number;
  storyboard: boolean;
  faststart_original: boolean;
  x264_preset: string;
  threads: number;
  nice: number;
  min_free_disk_gb: number;
}

const QUALITIES = [1080, 720, 480, 360];
const PRESETS = ['ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium'];

export function ProcessingSettingsPage() {
  useDocumentTitle('Pemrosesan - Studio');
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['admin', 'settings'], queryFn: () => apiGet<{ processing: Processing }>('/admin/settings') });
  const [form, setForm] = useState<Processing | null>(null);
  useEffect(() => {
    if (data) setForm(data.processing);
  }, [data]);
  const save = useMutation({
    mutationFn: (body: Processing) => apiPut('/admin/settings/processing', body),
    onSuccess: () => {
      toast('Pengaturan pemrosesan disimpan');
      void qc.invalidateQueries({ queryKey: ['admin', 'settings'] });
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
  const set = <K extends keyof Processing>(k: K, v: Processing[K]) => setForm({ ...form, [k]: v });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate(form);
  };

  return (
    <div className="dv-studio-page">
      <h1 className="dv-studio-page__title">Pemrosesan video</h1>
      <form onSubmit={submit}>
        <section className="dv-studio-card">
          <h2 className="dv-studio-card__title">Konversi kualitas</h2>
          <p className="dv-studio-card__subtitle">
            Server membuat versi kualitas lebih rendah (H.264) dan menyimpannya di folder <code className="dv-code">_dymasvideo_system/renditions</code> di Google
            Drive. Video yang formatnya tidak didukung browser (mis. MKV/HEVC) selalu dibuatkan versi kompatibel.
          </p>
          <div className="dv-form">
            <label className="dv-row">
              <Switch checked={form.enabled} onChange={(v) => set('enabled', v)} label="Aktifkan pemrosesan" />
              <span>Aktifkan pemrosesan (thumbnail tetap dibuat walau nonaktif)</span>
            </label>
            <div>
              <div className="dv-form__label">Kualitas tambahan</div>
              <div className="dv-row">
                {QUALITIES.map((q) => (
                  <Checkbox
                    key={q}
                    checked={form.renditions.includes(q)}
                    onChange={(on) => set('renditions', on ? [...form.renditions, q].sort((a, b) => b - a) : form.renditions.filter((x) => x !== q))}
                  >
                    {q}p
                  </Checkbox>
                ))}
              </div>
              <p className="dv-text-secondary" style={{ fontSize: '1.3rem', marginTop: 6 }}>
                Hanya dibuat bila lebih kecil dari resolusi asli. Setiap kualitas menambah pemakaian penyimpanan Drive & CPU.
              </p>
            </div>
            <label className="dv-row">
              <span style={{ minWidth: 260 }}>Resolusi maksimal versi kompatibel</span>
              <select className="dv-select" style={{ width: 160 }} value={form.compat_max_height} onChange={(e) => set('compat_max_height', Number(e.target.value))}>
                <option value={1080}>1080p</option>
                <option value={720}>720p</option>
              </select>
            </label>
            <label className="dv-row">
              <Switch checked={form.storyboard} onChange={(v) => set('storyboard', v)} label="Storyboard" />
              <span>Buat storyboard (gambar preview saat kursor di atas progress bar)</span>
            </label>
            <label className="dv-row">
              <Switch checked={form.faststart_original} onChange={(v) => set('faststart_original', v)} label="Rapikan file asli" />
              <span>
                Rapikan file asli MP4/MOV yang indeksnya di akhir file agar mulai diputar & seek lebih cepat. Tanpa encode ulang (kualitas audio & video
                identik), file asli di Drive <strong>ditimpa</strong> dan versi lamanya dihapus.
              </span>
            </label>
          </div>
        </section>

        <section className="dv-studio-card">
          <h2 className="dv-studio-card__title">Beban server</h2>
          <p className="dv-studio-card__subtitle">Konversi berjalan satu per satu dengan prioritas rendah agar situs lain di server tetap lancar.</p>
          <div className="dv-form">
            <label className="dv-row">
              <span style={{ minWidth: 260 }}>Preset kecepatan encode</span>
              <select className="dv-select" style={{ width: 160 }} value={form.x264_preset} onChange={(e) => set('x264_preset', e.target.value)}>
                {PRESETS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </label>
            <label className="dv-row">
              <span style={{ minWidth: 260 }}>Jumlah thread ffmpeg</span>
              <input className="dv-select" style={{ width: 160 }} type="number" min={1} max={16} value={form.threads} onChange={(e) => set('threads', Number(e.target.value))} />
            </label>
            <label className="dv-row">
              <span style={{ minWidth: 260 }}>Prioritas proses (nice 0–19)</span>
              <input className="dv-select" style={{ width: 160 }} type="number" min={0} max={19} value={form.nice} onChange={(e) => set('nice', Number(e.target.value))} />
            </label>
            <label className="dv-row">
              <span style={{ minWidth: 260 }}>Sisa disk minimal (GB)</span>
              <input
                className="dv-select"
                style={{ width: 160 }}
                type="number"
                min={1}
                max={1000}
                value={form.min_free_disk_gb}
                onChange={(e) => set('min_free_disk_gb', Number(e.target.value))}
              />
            </label>
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
