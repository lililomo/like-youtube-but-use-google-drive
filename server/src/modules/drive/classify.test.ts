import { describe, expect, it } from 'vitest';
import {
  isIgnoredFolder,
  isSubtitleFile,
  isVideoFile,
  languageLabel,
  matchSubtitle,
  parseFolderInput,
  searchTextFrom,
  titleFromName,
} from './classify.js';

const EXT = ['mp4', 'mkv', 'mov', 'webm', 'avi'];

describe('parseFolderInput', () => {
  const ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz012345';
  it.each([
    [ID, ID],
    [`  ${ID}  `, ID],
    [`https://drive.google.com/drive/folders/${ID}`, ID],
    [`https://drive.google.com/drive/folders/${ID}?usp=sharing`, ID],
    [`https://drive.google.com/drive/u/0/folders/${ID}`, ID],
    [`https://drive.google.com/drive/u/2/folders/${ID}?resourcekey=abc`, ID],
    [`https://drive.google.com/open?id=${ID}`, ID],
    [`https://drive.google.com/folderview?id=${ID}`, ID],
  ])('%s', (input, expected) => {
    expect(parseFolderInput(input)).toBe(expected);
  });
  it.each(['', 'pendek', 'https://evil.com/drive/folders/1AbCdEfGhIjKlMnOp', 'https://drive.google.com/drive/my-drive', 'bukan url / id'])(
    'menolak %s',
    (input) => {
      expect(parseFolderInput(input)).toBeNull();
    },
  );
});

describe('nama → judul', () => {
  it.each([
    ['Video Saya.mp4', 'Video Saya'],
    ['Film.Bagus.2024.mkv', 'Film.Bagus.2024'],
    ['tanpa-ekstensi', 'tanpa-ekstensi'],
    ['.hidden', '.hidden'],
    ['a.b.mp4', 'a.b'],
  ])('%s → %s', (name, title) => {
    expect(titleFromName(name)).toBe(title);
  });
  it('search text', () => {
    expect(searchTextFrom('My_Video.Final-2024')).toBe('my video final 2024');
    expect(searchTextFrom('  Halo   Dunia ')).toBe('halo dunia');
  });
});

describe('klasifikasi', () => {
  it('video berdasarkan mime atau ekstensi', () => {
    expect(isVideoFile({ name: 'a.mp4', mimeType: 'video/mp4' }, EXT)).toBe(true);
    expect(isVideoFile({ name: 'a.mkv', mimeType: 'application/octet-stream' }, EXT)).toBe(true);
    expect(isVideoFile({ name: 'a.bin', mimeType: 'video/x-unknown' }, EXT)).toBe(true);
    expect(isVideoFile({ name: 'a.txt', mimeType: 'text/plain' }, EXT)).toBe(false);
    expect(isVideoFile({ name: 'x_720p.mp4', mimeType: 'video/mp4', appProperties: { dvRole: 'rendition' } }, EXT)).toBe(false);
  });
  it('subtitle', () => {
    expect(isSubtitleFile({ name: 'a.srt', mimeType: 'application/x-subrip' })).toBe(true);
    expect(isSubtitleFile({ name: 'a.VTT', mimeType: 'text/vtt' })).toBe(true);
    expect(isSubtitleFile({ name: 'a.ass', mimeType: 'text/plain' })).toBe(false);
  });
  it('folder diabaikan', () => {
    expect(isIgnoredFolder({ name: '_dymasvideo_system' })).toBe(true);
    expect(isIgnoredFolder({ name: '.cache' })).toBe(true);
    expect(isIgnoredFolder({ name: 'Film', appProperties: { dvRole: 'system' } })).toBe(true);
    expect(isIgnoredFolder({ name: 'Film' })).toBe(false);
  });
});

describe('matchSubtitle', () => {
  const titles = new Set(['Judul', 'Film.Bagus.2024']);
  it.each([
    ['Judul.srt', { title: 'Judul', lang: null }],
    ['Judul.id.srt', { title: 'Judul', lang: 'id' }],
    ['Judul.en.forced.vtt', { title: 'Judul', lang: 'en' }],
    ['Judul.pt-BR.srt', { title: 'Judul', lang: 'pt-br' }],
    ['Film.Bagus.2024.srt', { title: 'Film.Bagus.2024', lang: null }],
    ['Film.Bagus.2024.id.srt', { title: 'Film.Bagus.2024', lang: 'id' }],
  ])('%s', (name, expected) => {
    expect(matchSubtitle(name, titles)).toEqual(expected);
  });
  it.each(['Lain.srt', 'Judul.indonesia1.srt', 'Judulx.id.srt'])('tidak cocok: %s', (name) => {
    expect(matchSubtitle(name, titles)).toBeNull();
  });
  it('label bahasa', () => {
    expect(languageLabel('id')).toBe('Indonesia');
    expect(languageLabel('en')).toBe('Inggris');
    expect(languageLabel(null)).toBe('Subtitle');
  });
});
