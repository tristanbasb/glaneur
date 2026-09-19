import fs from 'node:fs';
import path from 'node:path';
import fastifyCookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyError } from 'fastify';
import { isAuthenticated } from './auth.js';
import { config } from './config.js';
import { ValidationError } from './feeds.js';
import { authRoutes } from './routes/auth.js';
import { feedRoutes } from './routes/feeds.js';
import { publicRoutes } from './routes/public.js';
import { settingsRoutes } from './routes/settings.js';
import { errorMessage, log } from './util.js';

const PUBLIC_API = new Set(['/api/auth/status', '/api/auth/login', '/api/auth/setup']);

export async function buildApp() {
  const app = Fastify({ trustProxy: config.trustProxy, bodyLimit: 10 * 1024 * 1024, logger: false });
  await app.register(fastifyCookie);

  app.setErrorHandler((err: FastifyError, req, reply) => {
    if (err instanceof ValidationError) return reply.code(400).send({ error: err.message });
    const status = err.statusCode && err.statusCode >= 400 && err.statusCode < 600 ? err.statusCode : 500;
    if (status >= 500) log.error(`${req.method} ${req.url}`, err);
    return reply.code(status).send({ error: status === 500 ? errorMessage(err) : err.message });
  });

  // API guard: session required, and a custom header on writes (blocks cross-site form posts).
  app.addHook('onRequest', async (req, reply) => {
    const pathname = req.url.split('?')[0];
    if (!pathname.startsWith('/api/')) return;
    reply.header('cache-control', 'no-store');
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.headers['x-glaneur'] !== '1') {
      return reply.code(403).send({ error: 'Requête refusée.' });
    }
    if (PUBLIC_API.has(pathname) || isAuthenticated(req)) return;
    return reply.code(401).send({ error: 'Session expirée : reconnectez-vous.' });
  });

  await app.register(authRoutes);
  await app.register(feedRoutes);
  await app.register(settingsRoutes);
  await app.register(publicRoutes);

  if (fs.existsSync(path.join(config.webDir, 'index.html'))) {
    await app.register(fastifyStatic, {
      root: config.webDir,
      wildcard: false,
      setHeaders(reply, file) {
        const immutable = file.includes(`${path.sep}assets${path.sep}`);
        reply.header('cache-control', immutable ? 'public, max-age=31536000, immutable' : 'no-cache');
      },
    });
    app.setNotFoundHandler((req, reply) => {
      const pathname = req.url.split('?')[0];
      const spaRoute = (req.method === 'GET' || req.method === 'HEAD') && !pathname.startsWith('/api/') && !pathname.startsWith('/f/');
      if (spaRoute) return reply.header('cache-control', 'no-cache').sendFile('index.html');
      return reply.code(404).send({ error: 'Introuvable.' });
    });
  } else {
    app.setNotFoundHandler((_req, reply) => reply.code(404).send({ error: 'Introuvable (interface non compilée : lancez « npm run build »).' }));
  }

  return app;
}
