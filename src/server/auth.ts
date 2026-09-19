import crypto from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { config } from './config.js';
import { get, run } from './db.js';
import { readSetting, writeSetting } from './settings.js';
import { randomToken, sha256 } from './util.js';

export const SESSION_COOKIE = 'glaneur_session';
const SESSION_TTL_MS = 30 * 24 * 3600_000;

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$8$1$${salt.toString('base64')}$${hash.toString('base64')}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [scheme, n, r, p, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = crypto.scryptSync(password, Buffer.from(salt, 'base64'), expected.length, { N: Number(n), r: Number(r), p: Number(p) });
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

export function hasPassword(): boolean {
  return !!readSetting<string>('passwordHash');
}

export function checkPassword(password: string): boolean {
  const stored = readSetting<string>('passwordHash');
  return !!stored && verifyPassword(password, stored);
}

export function setPassword(password: string): void {
  writeSetting('passwordHash', hashPassword(password));
  run('DELETE FROM sessions');
}

/** GLANEUR_PASSWORD, when set, always wins over the stored password. */
export function applyInitialPassword(): void {
  if (!config.initialPassword) return;
  const stored = readSetting<string>('passwordHash');
  if (!stored || !verifyPassword(config.initialPassword, stored)) writeSetting('passwordHash', hashPassword(config.initialPassword));
}

export function passwordProblem(password: unknown): string | null {
  if (typeof password !== 'string' || password.length < 8) return 'Le mot de passe doit contenir au moins 8 caractères.';
  if (password.length > 200) return 'Le mot de passe est trop long.';
  return null;
}

export function createSession(reply: FastifyReply, req: FastifyRequest): void {
  const token = randomToken(32);
  const now = Date.now();
  run('DELETE FROM sessions WHERE expires_at < ?', now);
  run(
    'INSERT INTO sessions (token_hash, created_at, expires_at, user_agent) VALUES (?, ?, ?, ?)',
    sha256(token),
    now,
    now + SESSION_TTL_MS,
    (req.headers['user-agent'] ?? '').slice(0, 300),
  );
  reply.setCookie(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: req.protocol === 'https',
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export function destroySession(reply: FastifyReply, req: FastifyRequest): void {
  const token = req.cookies[SESSION_COOKIE];
  if (token) run('DELETE FROM sessions WHERE token_hash = ?', sha256(token));
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
}

export function isAuthenticated(req: FastifyRequest): boolean {
  if (config.authMode === 'none') return true;
  const token = req.cookies[SESSION_COOKIE];
  if (!token) return false;
  const row = get<{ expires_at: number }>('SELECT expires_at FROM sessions WHERE token_hash = ?', sha256(token));
  return !!row && row.expires_at > Date.now();
}

const attempts = new Map<string, { count: number; resetAt: number }>();

/** At most 10 login attempts per 5 minutes per client address. */
export function allowLoginAttempt(ip: string): boolean {
  const now = Date.now();
  const entry = attempts.get(ip);
  if (!entry || entry.resetAt < now) {
    attempts.set(ip, { count: 1, resetAt: now + 5 * 60_000 });
    return true;
  }
  entry.count++;
  return entry.count <= 10;
}
