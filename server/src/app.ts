import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import { APP_VERSION, config, isProd } from './config.js';
import { pingDb } from './db.js';
import { AppError, errorBody } from './lib/errors.js';
import { settings } from './modules/settings/service.js';
import { registerSpa } from './plugins/spa.js';

const startedAt = Date.now();

/** Sembunyikan signature stream (?s=) dari log. */
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
    disableRequestLogging: false,
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
    const message = status >= 500 && isProd ? 'Terjadi kesalahan pada server' : err.message;
    return reply.code(status).send(errorBody(status >= 500 ? 'INTERNAL' : 'ERROR', message));
  });

  await settings.load();

  app.get('/api/health', async (_req, reply) => {
    const db = await pingDb();
    return reply.code(db ? 200 : 503).send({
      ok: db,
      db,
      version: APP_VERSION,
      uptime: Math.round((Date.now() - startedAt) / 1000),
    });
  });

  await registerSpa(app, { distDir: config.WEB_DIST_DIR });

  return app;
}
