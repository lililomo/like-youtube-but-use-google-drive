import { useRef, useState } from 'react';
import type { VideoSummary } from '../../lib/types';
import { watchUrl } from '../../lib/videoQueries';
import { toast } from '../../stores/toast';
import { IconButton } from '../ui/Button';
import { MenuItem, Popup } from '../ui/Popup';
import { SaveDialog } from '../playlist/SaveDialog';

export async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
}

export async function shareVideo(video: Pick<VideoSummary, 'id' | 'title'>): Promise<void> {
  const url = `${window.location.origin}${watchUrl(video.id)}`;
  if (navigator.share && window.matchMedia('(hover: none)').matches) {
    try {
      await navigator.share({ title: video.title, url });
      return;
    } catch {
      /* dibatalkan → salin */
    }
  }
  await copyText(url);
  toast('Link disalin ke papan klip');
}

/** Tombol ⋮ pada kartu video. */
export function VideoMenu({ video }: { video: VideoSummary }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  return (
    <>
      {saving && <SaveDialog open onClose={() => setSaving(false)} videoId={video.id} />}
      <IconButton ref={anchor} icon="more-vert" label="Menu tindakan" tooltip={false} size={40} className="dv-video-menu-btn" onClick={(e) => {
        e.preventDefault();
        setOpen(!open);
      }} />
      <Popup open={open} onClose={() => setOpen(false)} anchorRef={anchor} align="right">
        <MenuItem
          icon="playlist-add"
          onClick={() => {
            setOpen(false);
            setSaving(true);
          }}
        >
          Simpan ke playlist
        </MenuItem>
        <MenuItem
          icon="share"
          onClick={() => {
            setOpen(false);
            void shareVideo(video);
          }}
        >
          Bagikan
        </MenuItem>
      </Popup>
    </>
  );
}
