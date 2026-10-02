import { describe, expect, it } from 'vitest';
import { driveFileName } from './service.js';
import { parseYoutubeId, parseYoutubeLink, splitLinks, unsupportedPlaylistReason } from './url.js';
import { explainYtdlpError, summarizeInfo, summarizePlaylist, YtPermanentError } from './ytdlp.js';

describe('parseYoutubeId', () => {
  it.each([
    ['https://www.youtube.com/watch?v=XjmTfkf8z3c', 'XjmTfkf8z3c'],
    ['https://www.youtube.com/watch?v=XjmTfkf8z3c&list=PL123&index=2&t=30s', 'XjmTfkf8z3c'],
    ['youtube.com/watch?v=XjmTfkf8z3c', 'XjmTfkf8z3c'],
    ['https://m.youtube.com/watch?v=XjmTfkf8z3c', 'XjmTfkf8z3c'],
    ['https://music.youtube.com/watch?v=XjmTfkf8z3c&feature=share', 'XjmTfkf8z3c'],
    ['https://youtu.be/XjmTfkf8z3c?si=abc', 'XjmTfkf8z3c'],
    ['https://www.youtube.com/shorts/2uThnYpGYWU', '2uThnYpGYWU'],
    ['https://www.youtube.com/live/2uThnYpGYWU?feature=shared', '2uThnYpGYWU'],
    ['https://www.youtube-nocookie.com/embed/2uThnYpGYWU', '2uThnYpGYWU'],
    ['2uThnYpGYWU', '2uThnYpGYWU'],
  ])('%s', (input, id) => expect(parseYoutubeId(input)).toBe(id));

  it.each([
    'https://www.youtube.com/playlist?list=PL123',
    'https://www.youtube.com/@channel',
    'https://vimeo.com/123456',
    'https://evil.example/watch?v=XjmTfkf8z3c',
    'https://www.youtube.com/watch?v=short',
    'bukan link',
  ])('menolak %s', (input) => expect(parseYoutubeId(input)).toBeNull());

  it('memecah banyak link', () => {
    expect(splitLinks(' https://youtu.be/a1\n\nhttps://youtu.be/b2 , c3\t')).toEqual(['https://youtu.be/a1', 'https://youtu.be/b2', 'c3']);
  });
});

describe('parseYoutubeLink (playlist)', () => {
  it.each([
    ['https://www.youtube.com/watch?v=tZYV48dk_6M&list=PL0Es4f51CsxwO0Rcgx4Zs5c1qKJG6tWjI', 'tZYV48dk_6M', 'PL0Es4f51CsxwO0Rcgx4Zs5c1qKJG6tWjI'],
    ['https://www.youtube.com/playlist?list=PL0Es4f51CsxwO0Rcgx4Zs5c1qKJG6tWjI', null, 'PL0Es4f51CsxwO0Rcgx4Zs5c1qKJG6tWjI'],
    ['https://youtu.be/tZYV48dk_6M?list=PL0Es4f51CsxwO0Rcgx4Zs5c1qKJG6tWjI', 'tZYV48dk_6M', 'PL0Es4f51CsxwO0Rcgx4Zs5c1qKJG6tWjI'],
    ['https://music.youtube.com/playlist?list=OLAK5uy_kQqk1Zv7Q6y9p4f3m2Xc8bT0aBcDeFgHi', null, 'OLAK5uy_kQqk1Zv7Q6y9p4f3m2Xc8bT0aBcDeFgHi'],
    ['PL0Es4f51CsxwO0Rcgx4Zs5c1qKJG6tWjI', null, 'PL0Es4f51CsxwO0Rcgx4Zs5c1qKJG6tWjI'],
    ['https://www.youtube.com/watch?v=tZYV48dk_6M', 'tZYV48dk_6M', null],
  ])('%s', (input, videoId, playlistId) => expect(parseYoutubeLink(input)).toEqual({ videoId, playlistId }));

  it('menolak host lain & playlist tak didukung', () => {
    expect(parseYoutubeLink('https://evil.example/playlist?list=PL0Es4f51CsxwO0Rcgx4Zs5c1qKJG6tWjI')).toBeNull();
    expect(parseYoutubeLink('https://www.youtube.com/playlist?list=x')).toBeNull();
    expect(unsupportedPlaylistReason('RDtZYV48dk_6M')).toContain('Mix');
    expect(unsupportedPlaylistReason('WL')).toContain('login');
    expect(unsupportedPlaylistReason('PL0Es4f51CsxwO0Rcgx4Zs5c1qKJG6tWjI')).toBeNull();
  });
});

describe('ytdlp helpers', () => {
  it('ringkasan format terpilih (video + audio)', () => {
    const s = summarizeInfo({
      id: 'XjmTfkf8z3c',
      title: ' Es Krim ',
      channel: 'Bing',
      duration: 381.4,
      ext: 'mp4',
      requested_formats: [
        { format_id: '137', filesize: 70_000_000, width: 1920, height: 1080, vcodec: 'avc1.640028', acodec: 'none' },
        { format_id: '140', filesize: 6_000_000, vcodec: 'none', acodec: 'mp4a.40.2' },
      ],
    });
    expect(s).toMatchObject({ title: 'Es Krim', height: 1080, vcodec: 'H.264', acodec: 'AAC', durationSec: 381, sizeEstimate: 76_000_000, formatIds: ['137', '140'] });
  });

  it('video vertikal: tinggi = sisi pendek', () => {
    const s = summarizeInfo({ id: 'x', requested_formats: [{ format_id: '1', width: 1080, height: 1920, vcodec: 'vp09.00', acodec: 'none' }, { format_id: '2', acodec: 'opus', vcodec: 'none' }] });
    expect(s.height).toBe(1080);
    expect(s.sizeEstimate).toBeNull();
  });

  it('error permanen vs sementara', () => {
    expect(explainYtdlpError('WARNING: x\nERROR: [youtube] XjmTfkf8z3c: Private video. Sign in if you have access')).toBeInstanceOf(YtPermanentError);
    expect(explainYtdlpError("ERROR: [youtube] XjmTfkf8z3c: Sign in to confirm you're not a bot").message).toContain('bukan bot');
    expect(explainYtdlpError('ERROR: [youtube] aaaaaaaaaaa: This video is unavailable')).toBeInstanceOf(YtPermanentError);
    expect(explainYtdlpError('ERROR: [youtube] x: Video unavailable. This video has been removed by the uploader').message).toContain('tidak tersedia');
    const temp = explainYtdlpError('ERROR: unable to download video data: HTTP Error 503: Service Unavailable');
    expect(temp).not.toBeInstanceOf(YtPermanentError);
    expect(temp.message).toContain('HTTP Error 503');
  });

  it('ringkasan playlist: entri privat/dihapus ditandai, ID tidak valid dibuang', () => {
    const pl = summarizePlaylist({
      id: 'PL0Es4f51CsxwO0Rcgx4Zs5c1qKJG6tWjI',
      title: ' Membantu Teman ',
      channel: 'Bing',
      entries: [
        { id: 'tZYV48dk_6M', title: 'Atchoo!', duration: 443.2 },
        { id: '59QG9DOW64k', title: '[Private video]' },
        { id: 'dX3CWTOSO2I', title: '[Deleted video]' },
        { id: 'Rdu9qi5EcVM', title: 'Menginap', availability: 'subscriber_only' },
        null,
        { id: 'bad' },
      ],
    });
    expect(pl.title).toBe('Membantu Teman');
    expect(pl.entries.map((e) => [e.id, e.unavailable])).toEqual([
      ['tZYV48dk_6M', null],
      ['59QG9DOW64k', 'Video privat di YouTube'],
      ['dX3CWTOSO2I', 'Video sudah dihapus di YouTube'],
      ['Rdu9qi5EcVM', 'Butuh login/khusus anggota'],
    ]);
    expect(pl.entries[0]!.durationSec).toBe(443);
  });

  it('nama file Drive dari judul', () => {
    expect(driveFileName('  Judul\u0007 /  Bagus  ', 'abc', '.mp4')).toBe('Judul / Bagus.mp4');
    expect(driveFileName('   ', 'XjmTfkf8z3c', '.mkv')).toBe('XjmTfkf8z3c.mkv');
  });
});
