import { useQuery } from '@tanstack/react-query';
import { useCallback, useRef, useState } from 'react';
import { apiGet } from '../lib/api';
import type { Page, VideoDetail, VideoSummary } from '../lib/types';
import type { Player } from '../player/Player';
import { PlayerView } from '../player/PlayerView';
import { useDocumentTitle } from '../hooks/useSite';

/** Halaman uji pemutar (khusus admin): pilih video, lihat log event. */
export function DevPlayerPage() {
  useDocumentTitle('Uji pemutar');
  const list = useQuery({ queryKey: ['dev', 'feed'], queryFn: () => apiGet<Page<VideoSummary>>('/feed?limit=48') });
  const [id, setId] = useState<string>('');
  const [theater, setTheater] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const playerRef = useRef<Player | null>(null);
  const add = useCallback((m: string) => setLog((l) => [`${new Date().toLocaleTimeString('id-ID')} ${m}`, ...l].slice(0, 50)), []);
  const selected = id || list.data?.items[0]?.id || '';
  const detail = useQuery({
    queryKey: ['video', selected],
    queryFn: () => apiGet<VideoDetail>(`/videos/${selected}`),
    enabled: Boolean(selected),
    placeholderData: (p) => p,
  });

  return (
    <div className="dv-devplayer">
      <div className="dv-row" style={{ marginBottom: 12 }}>
        <select className="dv-select" style={{ maxWidth: 420 }} value={selected} onChange={(e) => setId(e.target.value)} aria-label="Pilih video">
          {list.data?.items.map((v) => (
            <option key={v.id} value={v.id}>
              {v.title}
            </option>
          ))}
        </select>
        {detail.data && (
          <span className="dv-text-secondary">
            {detail.data.sources.map((s) => s.label).join(' · ')} · subtitle: {detail.data.subtitles.length} · storyboard: {detail.data.storyboard ? 'ya' : 'tidak'}
          </span>
        )}
      </div>
      <div className={`dv-devplayer__box${theater ? ' is-theater' : ''}`}>
        {detail.data && (
          <PlayerView
            detail={detail.data}
            autoplay={false}
            theater={theater}
            hasNext
            playerRef={playerRef}
            onTheater={(on) => {
              setTheater(on);
              add(`theater ${on}`);
            }}
            onEnded={() => add('ended')}
            onNext={() => add('next')}
            onPrev={() => add('prev')}
            onProgress={(p) => add(`progress ${p.position.toFixed(1)}/${p.duration.toFixed(1)}`)}
            onViewQualified={() => add('viewqualified')}
            onAutoplayChange={(on) => add(`autoplay ${on}`)}
          />
        )}
      </div>
      <pre className="dv-devplayer__log">{log.join('\n')}</pre>
    </div>
  );
}
