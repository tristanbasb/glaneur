import type { FastifyInstance } from 'fastify';
import type { AuthStatus } from '../../shared/types.js';
import {
  allowLoginAttempt,
  checkPassword,
  createSession,
  destroySession,
  hasPassword,
  isAuthenticated,
  passwordProblem,
  setPassword,
} from '../auth.js';
import { config } from '../config.js';

export async function authRoutes(app: FastifyInstance) {
  app.get('/api/auth/status', async (req): Promise<AuthStatus> => ({
    authenticated: isAuthenticated(req),
    setupRequired: config.authMode === 'password' && !hasPassword(),
    authMode: config.authMode,
  }));

  app.post('/api/auth/setup', async (req, reply) => {
    if (config.authMode === 'none' || hasPassword()) return reply.code(409).send({ error: 'Le mot de passe est déjà défini.' });
    const { password } = (req.body ?? {}) as { password?: unknown };
    const problem = passwordProblem(password);
    if (problem) return reply.code(400).send({ error: problem });
    setPassword(password as string);
    createSession(reply, req);
    return { ok: true };
  });

  app.post('/api/auth/login', async (req, reply) => {
    if (!allowLoginAttempt(req.ip)) return reply.code(429).send({ error: 'Trop de tentatives : réessayez dans quelques minutes.' });
    const { password } = (req.body ?? {}) as { password?: unknown };
    if (typeof password !== 'string' || !checkPassword(password)) return reply.code(401).send({ error: 'Mot de passe incorrect.' });
    createSession(reply, req);
    return { ok: true };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    destroySession(reply, req);
    return { ok: true };
  });

  app.post('/api/auth/password', async (req, reply) => {
    const { current, next } = (req.body ?? {}) as { current?: unknown; next?: unknown };
    if (hasPassword() && (typeof current !== 'string' || !checkPassword(current))) {
      return reply.code(403).send({ error: 'Mot de passe actuel incorrect.' });
    }
    const problem = passwordProblem(next);
    if (problem) return reply.code(400).send({ error: problem });
    setPassword(next as string);
    createSession(reply, req);
    return { ok: true };
  });
}
