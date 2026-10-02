/** Error aplikasi dengan kode & status HTTP, diformat seragam oleh error handler. */
export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message = 'Permintaan tidak valid', details?: unknown) =>
  new AppError(400, 'BAD_REQUEST', message, details);
export const unauthorized = (message = 'Silakan login terlebih dahulu') =>
  new AppError(401, 'UNAUTHORIZED', message);
export const forbidden = (message = 'Akses ditolak') => new AppError(403, 'FORBIDDEN', message);
export const notFound = (message = 'Tidak ditemukan', code = 'NOT_FOUND') => new AppError(404, code, message);
export const conflict = (message: string, details?: unknown) => new AppError(409, 'CONFLICT', message, details);
export const tooMany = (message = 'Terlalu banyak permintaan, coba lagi nanti') =>
  new AppError(429, 'TOO_MANY_REQUESTS', message);

export type ErrorBody = { error: { code: string; message: string; details?: unknown } };

export function errorBody(code: string, message: string, details?: unknown): ErrorBody {
  return details === undefined ? { error: { code, message } } : { error: { code, message, details } };
}
