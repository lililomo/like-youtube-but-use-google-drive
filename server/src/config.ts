import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const here = dirname(fileURLToPath(import.meta.url));
/** Root proyek: server/src|dist → ../.. */
export const PROJECT_ROOT = resolve(here, '../..');

const envFile = process.env.DV_ENV_FILE ?? resolve(PROJECT_ROOT, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const bool = z
  .string()
  .optional()
  .transform((v) => v === '1' || v === 'true');

const schema = z.object({
  NODE_ENV: z.enum(['production', 'development', 'test']).default('production'),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().positive().default(3210),
  APP_URL: z.string().url().default('https://video.dymas.cloud'),
  TRUST_PROXY: z.string().default('127.0.0.1'),

  DB_HOST: z.string().default('localhost'),
  DB_PORT: z.coerce.number().int().positive().default(3306),
  DB_USER: z.string().min(1),
  DB_PASSWORD: z.string().default(''),
  DB_NAME: z.string().min(1),
  DB_SOCKET: z.string().optional().default(''),

  APP_KEY: z
    .string()
    .regex(/^base64:[A-Za-z0-9+/=]{43,}$/, 'APP_KEY harus berformat base64:<32 byte>'),
  INTERNAL_TOKEN: z.string().min(32),

  STORAGE_DIR: z.string().default(resolve(PROJECT_ROOT, 'storage')),
  WEB_DIST_DIR: z.string().default(resolve(PROJECT_ROOT, 'web/dist')),
  FFMPEG_PATH: z.string().default('/usr/bin/ffmpeg'),
  FFPROBE_PATH: z.string().default('/usr/bin/ffprobe'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  ADMIN_USERNAME: z.string().default('admin'),
  ADMIN_INITIAL_PASSWORD: z.string().optional(),

  DISABLE_SCHEDULER: bool,
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
  // stdout (bukan stderr): skrip start aaPanel hanya mengarahkan stdout ke file log.
  process.stdout.write(`Konfigurasi .env tidak valid:\n${issues}\n`);
  process.exit(1);
}

export const config = parsed.data;
export type Config = typeof config;

export const isProd = config.NODE_ENV === 'production';

/** 32 byte kunci utama dari APP_KEY. */
export const appKeyBytes: Buffer = Buffer.from(config.APP_KEY.slice('base64:'.length), 'base64');
if (appKeyBytes.length !== 32) {
  process.stdout.write('APP_KEY harus 32 byte (base64).\n');
  process.exit(1);
}

const pkg = JSON.parse(readFileSync(resolve(PROJECT_ROOT, 'package.json'), 'utf8')) as { version: string };
export const APP_VERSION = pkg.version;
