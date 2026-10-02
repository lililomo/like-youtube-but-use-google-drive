import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { errorBody } from '../lib/errors.js';

/** Mengembalikan HTML meta (title, og:*) untuk disisipkan ke index.html, atau null. */
export type MetaResolver = (req: FastifyRequest) => Promise<string | null>;

/** Identitas situs yang disisipkan ke setiap index.html (nama, favicon, data awal untuk frontend). */
export interface SiteHead {
  title: string;
  faviconUrl: string | null;
  touchIconUrl: string | null;
  /** Disajikan sebagai <script type="application/json" id="dv-site"> (bukan skrip yang dieksekusi → aman untuk CSP). */
  boot: unknown;
}

const META_PLACEHOLDER = '<!--DV_META-->';
const NON_SPA_PREFIXES = ['/api/', '/stream/', '/internal/', '/media/', '/assets/'];

const FALLBACK_HTML = `<!doctype html><html lang="id"><head><meta charset="utf-8"><title>GDrive Tube</title></head>
<body><p>Frontend belum di-build.</p></body></html>`;

/** JSON aman di dalam <script type="application/json"> (tidak bisa menutup tag). */
export function jsonForHtml(value: unknown): string {
  return JSON.stringify(value).replaceAll('<', '\\u003c').replaceAll('>', '\\u003e').replaceAll('&', '\\u0026');
}

/** Sisipkan identitas situs: <title>, favicon, apple-touch-icon & data awal. */
export function applySiteHead(html: string, site: SiteHead, meta: string | null): string {
  let out = html;
  if (meta) out = out.replace(/<title>[^<]*<\/title>/, '');
  else out = out.replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(site.title)}</title>`);
  if (site.faviconUrl) {
    out = out.replace(/<link rel="icon"[^>]*>/, `<link rel="icon" href="${escapeHtml(site.faviconUrl)}" type="image/png" />`);
  }
  const extra = [
    site.touchIconUrl ? `<link rel="apple-touch-icon" href="${escapeHtml(site.touchIconUrl)}" />` : '',
    `<meta name="application-name" content="${escapeHtml(site.title)}" />`,
    `<meta name="apple-mobile-web-app-title" content="${escapeHtml(site.title)}" />`,
    `<script type="application/json" id="dv-site">${jsonForHtml(site.boot)}</script>`,
    meta ?? '',
  ]
    .filter(Boolean)
    .join('\n    ');
  return out.replace(META_PLACEHOLDER, extra);
}

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
  opts: { distDir: string; metaResolver?: MetaResolver; siteHead?: () => SiteHead },
): Promise<void> {
  const indexPath = join(opts.distDir, 'index.html');
  // Dibaca ulang bila file berubah (build web tanpa restart aplikasi tetap aman).
  let cached = { mtimeMs: -1, html: FALLBACK_HTML };
  const loadIndex = (): string => {
    try {
      const { mtimeMs } = statSync(indexPath);
      if (mtimeMs !== cached.mtimeMs) cached = { mtimeMs, html: readFileSync(indexPath, 'utf8') };
    } catch {
      cached = { mtimeMs: -1, html: FALLBACK_HTML };
    }
    return cached.html;
  };

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
    let html = loadIndex();
    let meta: string | null = null;
    if (opts.metaResolver) {
      try {
        meta = await opts.metaResolver(req);
      } catch (err) {
        req.log.warn({ err }, 'gagal membuat meta SPA');
      }
    }
    if (opts.siteHead) html = applySiteHead(html, opts.siteHead(), meta);
    else if (meta) html = html.replace(/<title>[^<]*<\/title>/, '').replace(META_PLACEHOLDER, meta);
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
