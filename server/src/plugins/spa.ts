import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { errorBody } from '../lib/errors.js';

/** Mengembalikan HTML meta (title, og:*) untuk disisipkan ke index.html, atau null. */
export type MetaResolver = (req: FastifyRequest) => Promise<string | null>;

const META_PLACEHOLDER = '<!--DV_META-->';
const NON_SPA_PREFIXES = ['/api/', '/stream/', '/internal/', '/media/', '/assets/'];

const FALLBACK_HTML = `<!doctype html><html lang="id"><head><meta charset="utf-8"><title>Dymas Video</title></head>
<body><p>Frontend belum di-build.</p></body></html>`;

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/**
 * Menyajikan file statis hasil build web dan fallback SPA (index.html) untuk semua rute non-API.
 * index.html dibaca sekali saat start (deploy selalu me-restart aplikasi).
 */
export async function registerSpa(
  app: FastifyInstance,
  opts: { distDir: string; metaResolver?: MetaResolver },
): Promise<void> {
  const indexPath = join(opts.distDir, 'index.html');
  const indexHtml = existsSync(indexPath) ? readFileSync(indexPath, 'utf8') : FALLBACK_HTML;

  if (existsSync(opts.distDir)) {
    await app.register(fastifyStatic, {
      root: opts.distDir,
      prefix: '/',
      index: false,
      wildcard: true,
      cacheControl: false,
      setHeaders(res, path) {
        if (path.includes('/assets/')) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        } else {
          res.setHeader('Cache-Control', 'public, max-age=3600');
        }
      },
    });
  }

  const sendIndex = async (req: FastifyRequest, reply: FastifyReply) => {
    let html = indexHtml;
    if (opts.metaResolver) {
      try {
        const meta = await opts.metaResolver(req);
        if (meta) html = html.replace(/<title>[^<]*<\/title>/, '').replace(META_PLACEHOLDER, meta);
      } catch (err) {
        req.log.warn({ err }, 'gagal membuat meta SPA');
      }
    }
    return reply
      .code(200)
      .header('Cache-Control', 'no-cache')
      .type('text/html; charset=utf-8')
      .send(html);
  };

  // "/" ditangani eksplisit (static dengan index:false akan membalas 403 untuk direktori).
  app.get('/', sendIndex);

  app.setNotFoundHandler(async (req, reply) => {
    const path = (req.raw.url ?? '/').split('?')[0] ?? '/';
    const isSpaCandidate =
      (req.method === 'GET' || req.method === 'HEAD') &&
      path !== '/api' &&
      !NON_SPA_PREFIXES.some((p) => path.startsWith(p)) &&
      !/\.[a-z0-9]{2,5}$/i.test(path);

    if (!isSpaCandidate) {
      return reply.code(404).send(errorBody('NOT_FOUND', 'Tidak ditemukan'));
    }
    return sendIndex(req, reply);
  });
}
