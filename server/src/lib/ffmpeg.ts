import { spawn, type ChildProcess } from 'node:child_process';
import { config } from '../config.js';

/** Proses ffmpeg/ffprobe aktif (dibunuh saat shutdown). */
const children = new Set<ChildProcess>();

export function killAllChildren(signal: NodeJS.Signals = 'SIGTERM'): void {
  for (const c of children) c.kill(signal);
}

export interface RunOptions {
  nice?: number;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Dipanggil per baris stdout (mis. -progress pipe:1). */
  onLine?: (line: string) => void;
  /** Kumpulkan stdout sebagai Buffer (untuk frame mjpeg). */
  binaryStdout?: boolean;
  maxStderr?: number;
}

export interface RunResult {
  code: number | null;
  stdout: Buffer;
  stderr: string;
}

export class ProcessError extends Error {
  constructor(
    message: string,
    readonly code: number | null,
    readonly stderr: string,
  ) {
    super(message);
  }
}

export function run(cmd: string, args: string[], opts: RunOptions = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const [bin, argv] = opts.nice && opts.nice > 0 ? ['nice', ['-n', String(opts.nice), cmd, ...args]] : [cmd, args];
    const child = spawn(bin, argv, { stdio: ['ignore', 'pipe', 'pipe'] });
    children.add(child);
    const out: Buffer[] = [];
    let err = '';
    let partial = '';
    const maxErr = opts.maxStderr ?? 64 * 1024;
    child.stdout.on('data', (d: Buffer) => {
      if (opts.binaryStdout) out.push(d);
      if (opts.onLine) {
        partial += d.toString();
        const lines = partial.split('\n');
        partial = lines.pop() ?? '';
        lines.forEach((l) => opts.onLine!(l));
      } else if (!opts.binaryStdout) out.push(d);
    });
    child.stderr.on('data', (d: Buffer) => {
      if (err.length < maxErr) err += d.toString();
    });
    const timer = opts.timeoutMs ? setTimeout(() => child.kill('SIGKILL'), opts.timeoutMs) : undefined;
    const onAbort = () => child.kill('SIGTERM');
    opts.signal?.addEventListener('abort', onAbort, { once: true });
    child.on('error', (e) => {
      children.delete(child);
      reject(e);
    });
    child.on('close', (code) => {
      children.delete(child);
      if (timer) clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
      const result = { code, stdout: Buffer.concat(out), stderr: err };
      if (opts.signal?.aborted) return reject(new ProcessError('dibatalkan', code, err));
      if (code !== 0) return reject(new ProcessError(`${cmd} keluar dengan kode ${code}: ${err.trim().split('\n').slice(-3).join(' | ')}`, code, err));
      resolve(result);
    });
  });
}

/** URL proxy internal agar ffmpeg membaca file Drive tanpa memegang token Google. */
export function internalInput(fileId: string): { url: string; headerArgs: string[] } {
  return {
    url: `http://127.0.0.1:${config.PORT}/internal/drive/${fileId}`,
    headerArgs: ['-headers', `X-Internal-Token: ${config.INTERNAL_TOKEN}\r\n`],
  };
}

export interface ProbeResult {
  streams?: {
    codec_type?: string;
    codec_name?: string;
    width?: number;
    height?: number;
    pix_fmt?: string;
    duration?: string;
    disposition?: { attached_pic?: number };
    tags?: Record<string, string>;
    side_data_list?: { rotation?: number }[];
  }[];
  format?: { format_name?: string; duration?: string; bit_rate?: string; tags?: Record<string, string> };
}

export async function ffprobe(inputArgs: string[], opts: RunOptions = {}): Promise<ProbeResult> {
  const res = await run(config.FFPROBE_PATH, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', ...inputArgs], {
    timeoutMs: 120_000,
    ...opts,
  });
  return JSON.parse(res.stdout.toString()) as ProbeResult;
}

/** Parse baris -progress: out_time_us=… → detik. */
export function progressSeconds(line: string): number | null {
  const m = /^out_time_(?:us|ms)=(\d+)$/.exec(line.trim());
  return m ? Number(m[1]) / 1_000_000 : null;
}
