import { formatDuration } from '../../lib/format';
import type { VideoSummary } from '../../lib/types';
import { Icon } from '../icons/Icon';

const STATUS_LABEL: Record<string, string> = { pending: 'Menunggu proses', processing: 'Memproses…', failed: 'Gagal diproses', missing: 'Tidak tersedia' };

/** Thumbnail 16:9 dengan badge durasi & bar progres tonton. */
export function Thumbnail({
  video,
  sizes = '(max-width: 656px) 100vw, 360px',
  eager = false,
}: {
  video: Pick<VideoSummary, 'thumb' | 'durationSec' | 'progressSec' | 'status' | 'title'>;
  sizes?: string;
  eager?: boolean;
}) {
  const pct =
    video.progressSec && video.durationSec ? Math.min(100, Math.max(4, (video.progressSec / video.durationSec) * 100)) : 0;
  const notReady = video.status && video.status !== 'ready';
  return (
    <div className="dv-thumb">
      {video.thumb ? (
        <img
          className="dv-thumb__img"
          src={video.thumb.sd}
          srcSet={`${video.thumb.sd} 480w, ${video.thumb.hd} 1280w`}
          sizes={sizes}
          alt=""
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          fetchPriority={eager ? 'high' : 'auto'}
        />
      ) : (
        <div className="dv-thumb__placeholder">
          <Icon name="your-videos" size={40} />
        </div>
      )}
      {notReady ? (
        <span className="dv-thumb__badge dv-thumb__badge--status">{STATUS_LABEL[video.status!] ?? video.status}</span>
      ) : (
        video.durationSec != null && <span className="dv-thumb__badge">{formatDuration(video.durationSec)}</span>
      )}
      {pct > 0 && (
        <div className="dv-thumb__progress">
          <div style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  );
}
