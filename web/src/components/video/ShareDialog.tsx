import { useEffect, useState } from 'react';
import { formatDuration } from '../../lib/format';
import { watchUrl } from '../../lib/videoQueries';
import { toast } from '../../stores/toast';
import { Icon } from '../icons/Icon';
import { Button } from '../ui/Button';
import { Checkbox } from '../ui/misc';
import { Dialog } from '../ui/Dialog';
import { copyText } from './VideoMenu';

interface Target {
  id: string;
  label: string;
  color: string;
  href: (url: string, title: string) => string;
  icon: string;
}

// Ikon sederhana (bukan logo resmi) — cukup sebagai penanda tujuan berbagi.
const TARGETS: Target[] = [
  {
    id: 'wa',
    label: 'WhatsApp',
    color: '#25d366',
    href: (u, t) => `https://wa.me/?text=${encodeURIComponent(`${t} ${u}`)}`,
    icon: 'M12 3a9 9 0 0 0-7.8 13.5L3 21l4.6-1.2A9 9 0 1 0 12 3zm4.4 12.4c-.2.5-1.1 1-1.6 1-.4.1-.9.1-1.4-.1-.3-.1-.8-.2-1.3-.5-2.3-1-3.8-3.3-3.9-3.4-.1-.2-.9-1.2-.9-2.3s.6-1.6.8-1.9c.2-.2.4-.3.6-.3h.4c.1 0 .3 0 .5.4l.7 1.7c.1.1.1.3 0 .4l-.3.4-.3.3c-.1.1-.2.3-.1.5.1.2.6 1 1.3 1.6.9.8 1.6 1 1.8 1.1.2.1.4.1.5-.1l.7-.8c.2-.2.3-.2.5-.1l1.6.8c.2.1.4.2.4.3.1.1.1.6-.1 1.1z',
  },
  {
    id: 'tg',
    label: 'Telegram',
    color: '#27a7e7',
    href: (u, t) => `https://t.me/share/url?url=${encodeURIComponent(u)}&text=${encodeURIComponent(t)}`,
    icon: 'M20.7 4.3 2.9 11.2c-1.2.5-1.2 1.2-.2 1.5l4.6 1.4 1.8 5.4c.2.6.4.8.8.8s.6-.2.9-.5l2.2-2.1 4.6 3.4c.8.5 1.4.2 1.6-.8l3-14.1c.3-1.2-.5-1.8-1.5-1.3zM8.6 13.8l9.2-5.8c.4-.3.8-.1.5.2l-7.7 7-.3 3.4-1.7-4.8z',
  },
  {
    id: 'x',
    label: 'X',
    color: '#000000',
    href: (u, t) => `https://x.com/intent/tweet?url=${encodeURIComponent(u)}&text=${encodeURIComponent(t)}`,
    icon: 'M4 4h4.6l4 5.5L17.2 4H20l-6.1 7.1L20.5 20h-4.6l-4.3-5.9L6.5 20H3.7l6.6-7.6z',
  },
  {
    id: 'fb',
    label: 'Facebook',
    color: '#1877f2',
    href: (u) => `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(u)}`,
    icon: 'M13.5 21v-7.5h2.5l.4-3h-2.9V8.6c0-.9.3-1.5 1.5-1.5h1.5V4.4c-.3 0-1.2-.1-2.2-.1-2.2 0-3.7 1.3-3.7 3.8v2.4H8v3h2.6V21z',
  },
];

/** Dialog "Bagikan" ala YouTube: tujuan berbagi, tautan + Salin, "Mulai pada mm:ss". */
export function ShareDialog({
  open,
  onClose,
  video,
  currentTime = 0,
  playlistId,
}: {
  open: boolean;
  onClose: () => void;
  video: { id: string; title: string };
  currentTime?: number;
  /** Bagikan playlist (/playlist?list=) alih-alih video. */
  playlistId?: string;
}) {
  const [startAt, setStartAt] = useState(false);
  const at = playlistId ? 0 : Math.floor(currentTime);
  useEffect(() => {
    if (open) setStartAt(false);
  }, [open]);
  const url = playlistId
    ? `${window.location.origin}/playlist?list=${encodeURIComponent(playlistId)}`
    : `${window.location.origin}${watchUrl(video.id, startAt && at > 0 ? { t: String(at) } : undefined)}`;
  const nativeShare = typeof navigator.share === 'function';

  const copy = async () => {
    await copyText(url);
    toast('Link disalin ke papan klip');
  };

  return (
    <Dialog open={open} onClose={onClose} title="Bagikan" width={520} showClose className="dv-share">
      <div className="dv-share__targets">
        {TARGETS.map((tg) => (
          <a key={tg.id} className="dv-share__target" href={tg.href(url, video.title)} target="_blank" rel="noopener noreferrer">
            <span className="dv-share__icon" style={{ background: tg.color }}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d={tg.icon} />
              </svg>
            </span>
            <span className="dv-share__label">{tg.label}</span>
          </a>
        ))}
        {nativeShare && (
          <button
            type="button"
            className="dv-share__target"
            onClick={() => void navigator.share({ title: video.title, url }).catch(() => {})}
          >
            <span className="dv-share__icon dv-share__icon--more">
              <Icon name="share" />
            </span>
            <span className="dv-share__label">Lainnya</span>
          </button>
        )}
      </div>
      <div className="dv-share__link">
        <input className="dv-share__input" value={url} readOnly onFocus={(e) => e.currentTarget.select()} aria-label="Tautan video" />
        <Button variant="primary" onClick={() => void copy()}>
          Salin
        </Button>
      </div>
      {at > 0 && (
        <div className="dv-share__start">
          <Checkbox checked={startAt} onChange={setStartAt}>
            Mulai pada {formatDuration(at)}
          </Checkbox>
        </div>
      )}
    </Dialog>
  );
}
