import fastifyCookie from '@fastify/cookie';
import fastifyHelmet from '@fastify/helmet';
import fastifyRateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import { APP_VERSION, config, isProd } from './config.js';
import { pingDb } from './db.js';
import { sha256Hex } from './lib/crypto.js';
import { AppError, errorBody } from './lib/errors.js';
import { auditRoutes } from './modules/audit/service.js';
import { authRoutes } from './modules/auth/routes.js';
import { settings } from './modules/settings/service.js';
import { siteInfo, siteRoutes } from './modules/site/routes.js';
import { settingsRoutes } from './modules/settings/routes.js';
import { driveRoutes } from './modules/drive/routes.js';
import { syncRoutes } from './modules/sync/routes.js';
import { videoRoutes } from './modules/videos/routes.js';
import { manageRoutes } from './modules/videos/manage.js';
import { historyRoutes } from './modules/history/routes.js';
import { playlistRoutes } from './modules/playlists/routes.js';
import { uploadRoutes } from './modules/uploads/routes.js';
import { adminRoutes } from './modules/admin/routes.js';
import { subtitleManageRoutes } from './modules/subtitles/manage.js';
import { streamRoutes } from './modules/stream/routes.js';
import { subtitleRoutes } from './modules/subtitles/routes.js';
import { processingRoutes } from './modules/processing/routes.js';
import { importRoutes } from './modules/imports/routes.js';
import { publicVideoRoutes } from './modules/videos/public.js';
import { ogMeta } from './modules/videos/og.js';
import fastifyStatic from '@fastify/static';
import { join } from 'node:path';
import { userRoutes } from './modules/users/routes.js';
import { avatarRoutes } from './modules/users/avatar.js';
import { brandingRoutes } from './modules/branding/routes.js';
import { registerAuth } from './plugins/auth.js';
import { registerSpa } from './plugins/spa.js';

const startedAt = Date.now();

/** Sembunyikan signature stream & parameter OAuth dari log. */
function redactUrl(url: string | undefined): string | undefined {
  return url?.replace(/([?&](?:s|code|state)=)[^&]+/g, '$1***');
}

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      redact: {
        paths: [
          'req.headers.cookie',
          'req.headers.authorization',
          'req.headers["x-csrf-token"]',
          'req.headers["x-internal-token"]',
          'res.headers["set-cookie"]',
        ],
        censor: '[redacted]',
      },
      serializers: {
        req(req) {
          return { method: req.method, url: redactUrl(req.url), ip: req.ip };
        },
      },
    },
    trustProxy: config.TRUST_PROXY,
    bodyLimit: 1024 * 1024,
    requestIdHeader: false,
  });

  app.setErrorHandler((err: FastifyError | AppError, req, reply) => {
    if (err instanceof AppError) {
      return reply.code(err.status).send(errorBody(err.code, err.message, err.details));
    }
    const status = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
    if (status >= 500) req.log.error({ err }, 'unhandled error');
    if (err.validation) {
      return reply.code(400).send(errorBody('BAD_REQUEST', 'Permintaan tidak valid', err.validation));
    }
    if (status === 429) {
      return reply.code(429).send(errorBody('TOO_MANY_REQUESTS', 'Terlalu banyak permintaan, coba lagi nanti'));
    }
    if (status === 413) {
      return reply.code(413).send(errorBody('PAYLOAD_TOO_LARGE', 'Ukuran data terlalu besar'));
    }
    const message = status >= 500 && isProd ? 'Terjadi kesalahan pada server' : err.message;
    return reply.code(status).send(errorBody(status >= 500 ? 'INTERNAL' : 'ERROR', message));
  });

  await settings.load();

  await app.register(fastifyCookie);
  await app.register(fastifyHelmet, {
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        mediaSrc: ["'self'", 'blob:'],
        fontSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        frameAncestors: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'", 'https://accounts.google.com'],
      },
    },
    // add_header HSTS aaPanel tertimpa add_header di location / → kirim dari aplikasi.
    hsts: { maxAge: 31536000, includeSubDomains: false },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'same-origin' },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  });
  await app.register(fastifyRateLimit, {
    global: true,
    max: 600,
    timeWindow: '1 minute',
    keyGenerator: (req) => req.ip,
    allowList: (req) => !req.url.startsWith('/api/'),
  });

  await registerAuth(app);

  // SPEC §19: data API per-viewer → private, no-store (kecuali rute menetapkan sendiri);
  // /api/site & /api/categories memakai ETag agar revalidasi murah (304).
  app.addHook('onSend', async (req, reply, payload) => {
    if (!req.url.startsWith('/api/')) return payload;
    const path = req.url.split('?')[0];
    if (req.method === 'GET' && reply.statusCode === 200 && typeof payload === 'string' && (path === '/api/site' || path === '/api/categories')) {
      const etag = `W/"${sha256Hex(payload).slice(0, 20)}"`;
      reply.header('ETag', etag);
      reply.header('Cache-Control', 'private, no-cache');
      if (req.headers['if-none-match'] === etag) {
        reply.code(304);
        return '';
      }
      return payload;
    }
    if (!reply.hasHeader('cache-control')) reply.header('Cache-Control', 'private, no-store');
    return payload;
  });

  app.get('/api/health', { config: { rateLimit: false } }, async (_req, reply) => {
    const db = await pingDb();
    reply.header('Cache-Control', 'no-store');
    return reply.code(db ? 200 : 503).send({
      ok: db,
      db,
      version: APP_VERSION,
      uptime: Math.round((Date.now() - startedAt) / 1000),
    });
  });

  await app.register(siteRoutes);
  await app.register(authRoutes);
  await app.register(userRoutes);
  await app.register(avatarRoutes);
  await app.register(brandingRoutes);
  await app.register(auditRoutes);
  await app.register(settingsRoutes);
  await app.register(driveRoutes);
  await app.register(syncRoutes);
  await app.register(videoRoutes);
  await app.register(manageRoutes);
  await app.register(historyRoutes);
  await app.register(playlistRoutes);
  await app.register(uploadRoutes);
  await app.register(adminRoutes);
  await app.register(importRoutes);
  await app.register(subtitleManageRoutes);
  await app.register(streamRoutes);
  await app.register(subtitleRoutes);
  await app.register(processingRoutes);
  await app.register(publicVideoRoutes);

  // Produksi: /media disajikan nginx. Instance uji (SERVE_STATIC=1): disajikan Node.
  if (config.SERVE_STATIC) {
    await app.register(fastifyStatic, {
      root: join(config.STORAGE_DIR, 'public'),
      prefix: '/media/',
      decorateReply: false,
      cacheControl: false,
      setHeaders: (res) => res.setHeader('Cache-Control', 'public, max-age=2592000, immutable'),
    });
  }

  await registerSpa(app, {
    distDir: config.WEB_DIST_DIR,
    metaResolver: ogMeta,
    siteHead: () => {
      const site = siteInfo();
      return { title: site.name, faviconUrl: site.faviconUrl, touchIconUrl: site.touchIconUrl, boot: site };
    },
  });

  return app;
}
