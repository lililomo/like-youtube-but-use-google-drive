/** Parser WebVTT minimal + sanitasi teks cue (hanya <i>, <b>, <u> yang dipertahankan). */
export interface Cue {
  start: number;
  end: number;
  html: string;
}

function parseTime(s: string): number | null {
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})$/.exec(s.trim());
  if (!m) return null;
  return Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]!.padEnd(3, '0')) / 1000;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function sanitizeCueText(text: string): string {
  const escaped = escapeHtml(text.replace(/<v[^>]*>/gi, '').replace(/<\/v>/gi, '').replace(/<c[.\w]*>|<\/c>/gi, ''));
  return escaped
    .replace(/&lt;(\/?)(i|b|u)&gt;/gi, '<$1$2>')
    .replace(/&lt;[^&]*?&gt;/g, '')
    .replace(/\n/g, '<br>');
}

export function parseVtt(text: string): Cue[] {
  const cues: Cue[] = [];
  const blocks = text.replace(/\r\n?/g, '\n').split(/\n{2,}/);
  for (const block of blocks) {
    const lines = block.split('\n');
    const idx = lines.findIndex((l) => l.includes('-->'));
    if (idx === -1) continue;
    const [a, rest = ''] = lines[idx]!.split('-->');
    const start = parseTime(a ?? '');
    const end = parseTime(rest.trim().split(/\s+/)[0] ?? '');
    if (start == null || end == null || end <= start) continue;
    const body = lines.slice(idx + 1).join('\n').trim();
    if (!body) continue;
    cues.push({ start, end, html: sanitizeCueText(body) });
  }
  return cues.sort((x, y) => x.start - y.start);
}

/** Cue aktif pada waktu t (bisa lebih dari satu). */
export function activeCues(cues: Cue[], t: number): Cue[] {
  const out: Cue[] = [];
  for (const c of cues) {
    if (c.start > t) break;
    if (c.end > t) out.push(c);
  }
  return out;
}
