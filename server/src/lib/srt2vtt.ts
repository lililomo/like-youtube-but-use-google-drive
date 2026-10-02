/** Dekode teks subtitle: BOM UTF-8/UTF-16 dikenali; UTF-8 tidak valid → windows-1252. */
export function decodeSubtitle(buf: Buffer): string {
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return buf.subarray(3).toString('utf8');
  if (buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder('utf-16le').decode(buf.subarray(2));
  if (buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder('utf-16be').decode(buf.subarray(2));
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder('windows-1252').decode(buf);
  }
}

/** SRT/VTT → WebVTT bersih (koma ms → titik, tag ASS {\..} dibuang, tag HTML selain i/b/u dibuang). */
export function toWebVtt(text: string): string {
  let s = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const isVtt = /^WEBVTT/.test(s.trimStart());
  if (!isVtt) {
    s = s.replace(/(\d{1,2}:\d{2}:\d{2}),(\d{1,3})/g, (_m, t: string, ms: string) => `${t.padStart(8, '0')}.${ms.padEnd(3, '0')}`);
    // Format tanpa jam "00:01,000"? jarang; biarkan.
  }
  s = s
    .replace(/\{\\[^}]*\}/g, '')
    .replace(/<(?!\/?(?:i|b|u)\b)[^>]*>/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return isVtt ? `${s}\n` : `WEBVTT\n\n${s}\n`;
}
