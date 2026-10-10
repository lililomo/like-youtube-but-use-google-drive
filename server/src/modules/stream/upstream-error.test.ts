import { describe, expect, it } from 'vitest';
import { DriveError } from '../drive/client.js';
import { upstreamError } from './routes.js';

describe('upstreamError', () => {
  it('token Google dicabut → DRIVE_AUTH 503', () => {
    expect(upstreamError(new DriveError(401, 'INVALID_GRANT', 'x')).slice(0, 2)).toEqual([503, 'DRIVE_AUTH']);
    expect(upstreamError(new DriveError(412, 'NOT_CONNECTED', 'x'))[1]).toBe('DRIVE_AUTH');
  });
  it('kuota/rate limit Drive → DRIVE_QUOTA 503', () => {
    expect(upstreamError(new DriveError(403, 'downloadQuotaExceeded', 'x')).slice(0, 2)).toEqual([503, 'DRIVE_QUOTA']);
    expect(upstreamError(new DriveError(429, 'HTTP_429', 'x'))[1]).toBe('DRIVE_QUOTA');
  });
  it('lainnya → UPSTREAM 502', () => {
    expect(upstreamError(new DriveError(500, 'backendError', 'x')).slice(0, 2)).toEqual([502, 'UPSTREAM']);
    expect(upstreamError(new DriveError(502, 'TOKEN_ERROR', 'x'))[1]).toBe('UPSTREAM');
  });
});
