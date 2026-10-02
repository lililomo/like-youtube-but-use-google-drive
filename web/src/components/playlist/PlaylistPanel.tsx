import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { playlistUrl, playlistWatchUrl } from '../../lib/playlistQueries';
import type { PlaylistDetail, VideoSummary } from '../../lib/types';
import { Icon } from '../icons/Icon';
import { IconButton } from '../ui/Button';
import { Thumbnail } from '../video/Thumbnail';

/** Panel playlist di kolom kanan halaman tonton (SPEC §15.5). */
export function PlaylistPanel({
  detail,
  order,
  currentId,
  loop,
  shuffle,
  onToggleLoop,
  onToggleShuffle,
}: {
  detail: PlaylistDetail;
  order: VideoSummary[];
  currentId: string;
  loop: boolean;
  shuffle: boolean;
  onToggleLoop: () => void;
  onToggleShuffle: () => void;
}) {
  const p = detail.playlist;
  const idx = order.findIndex((v) => v.id === currentId);
  const listRef = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState(false);

  // Item aktif di-scroll ke dalam panel (tanpa menggulung halaman).
  useEffect(() => {
    const list = listRef.current;
    const active = list?.querySelector<HTMLElement>('.is-active');
    if (list && active) list.scrollTop = active.offsetTop - list.offsetTop - 8;
  }, [currentId, collapsed, order]);

  return (
    <section className={`dv-plpanel${collapsed ? ' is-collapsed' : ''}`} aria-label={`Playlist ${p.title}`}>
      <header className="dv-plpanel__header">
        <div className="dv-plpanel__heading">
          <h2 className="dv-plpanel__title">
            <Link to={playlistUrl(p.id)}>{p.title}</Link>
          </h2>
          <div className="dv-plpanel__sub">
            {p.owner ? <Link to={`/@${p.owner.handle}`}>{p.owner.name}</Link> : p.isGuest ? 'Perangkat ini' : null}
            {p.visibility === 'private' && (
              <span className="dv-private-tag">
                <Icon name="lock" size={14} /> Privat
              </span>
            )}
            <span className="dv-dot">-</span>
            {idx >= 0 ? idx + 1 : '–'} / {order.length}
          </div>
        </div>
        <IconButton icon={collapsed ? 'expand-more' : 'expand-less'} label={collapsed ? 'Buka playlist' : 'Tutup playlist'} onClick={() => setCollapsed(!collapsed)} />
      </header>
      {!collapsed && (
        <>
          <div className="dv-plpanel__controls">
            <IconButton icon="repeat" label={loop ? 'Ulangi playlist: aktif' : 'Ulangi playlist'} active={loop} onClick={onToggleLoop} />
            <IconButton icon="shuffle" label={shuffle ? 'Acak: aktif' : 'Acak playlist'} active={shuffle} onClick={onToggleShuffle} />
          </div>
          <div ref={listRef} className="dv-plpanel__list">
            {order.map((v, i) => (
              <Link
                key={v.id}
                to={playlistWatchUrl(v.id, p.id, i + 1) + (shuffle ? '&shuffle=1' : '')}
                className={`dv-plpanel__item${v.id === currentId ? ' is-active' : ''}`}
                aria-current={v.id === currentId ? 'true' : undefined}
              >
                <span className="dv-plpanel__index">{v.id === currentId ? <Icon name="play-arrow" size={16} /> : i + 1}</span>
                <span className="dv-plpanel__thumb">
                  <Thumbnail video={v} sizes="100px" />
                </span>
                <span className="dv-plpanel__meta">
                  <span className="dv-plpanel__item-title dv-clamp-2">{v.title}</span>
                  <span className="dv-plpanel__channel">{v.channel.name}</span>
                </span>
              </Link>
            ))}
            {detail.hiddenCount > 0 && <div className="dv-plpanel__hidden">{detail.hiddenCount} video tidak tersedia disembunyikan</div>}
          </div>
        </>
      )}
    </section>
  );
}
