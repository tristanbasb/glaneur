import crypto from 'node:crypto';

const ID_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';

export function randomId(length = 10): string {
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (const b of bytes) out += ID_ALPHABET[b % ID_ALPHABET.length];
  return out;
}

export function randomToken(bytes = 24): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function sha1(value: string): string {
  return crypto.createHash('sha1').update(value).digest('hex');
}

export function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function slugify(value: string): string {
  const slug = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  return slug || 'flux';
}

export function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  const cut = value.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return (space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd() + '…';
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly url: string,
  ) {
    super(`HTTP ${status}`);
  }
}

const STATUS_HINTS: Record<number, string> = {
  401: 'authentification requise',
  402: 'contenu payant ou protection anti-robot',
  403: 'accès refusé — le site bloque peut-être les robots',
  404: 'page introuvable',
  410: 'page supprimée',
  429: 'trop de requêtes, le site limite le débit',
  500: 'erreur interne du site',
  502: 'passerelle en erreur',
  503: 'site indisponible ou protection anti-robot',
};

/** Human-readable French message for any error thrown while fetching or extracting. */
export function errorMessage(err: unknown): string {
  if (err instanceof HttpError) {
    const hint = STATUS_HINTS[err.status];
    return `La page a répondu ${err.status}${hint ? ` (${hint})` : ''}.`;
  }
  if (err instanceof Error) {
    if (/Failed to launch the browser process|Target closed|Browser was not found/i.test(err.message)) {
      return 'Chromium n’a pas pu démarrer : vérifiez son installation (ou CHROMIUM_PATH) et la mémoire disponible.';
    }
    const cause = (err as Error & { cause?: { code?: string; message?: string } }).cause;
    const code = cause?.code ?? (err as Error & { code?: string }).code;
    if (err.name === 'TimeoutError' || err.name === 'AbortError' || /timeout/i.test(err.message)) return 'Délai dépassé : la page a mis trop de temps à répondre.';
    if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'Domaine introuvable : vérifiez l’adresse ou la connexion réseau.';
    if (code === 'ECONNREFUSED') return 'Connexion refusée par le serveur.';
    if (code === 'ECONNRESET' || code === 'UND_ERR_SOCKET') return 'La connexion a été coupée par le serveur.';
    if (code && /CERT|SSL|TLS/i.test(code)) return 'Certificat HTTPS invalide.';
    if (err.message === 'fetch failed' && cause?.message) return `Échec de la requête : ${cause.message}`;
    return err.message;
  }
  return String(err);
}

/** Simple counting semaphore. */
export class Semaphore {
  private queue: Array<() => void> = [];
  private active = 0;

  constructor(private readonly max: number) {}

  async acquire(): Promise<() => void> {
    if (this.active >= this.max) await new Promise<void>((resolve) => this.queue.push(resolve));
    this.active++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active--;
      this.queue.shift()?.();
    };
  }

  async use<T>(fn: () => Promise<T>): Promise<T> {
    const release = await this.acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  }
}

function stamp(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

export const log = {
  info: (...args: unknown[]) => console.log(stamp(), '·', ...args),
  warn: (...args: unknown[]) => console.warn(stamp(), '!', ...args),
  error: (...args: unknown[]) => console.error(stamp(), '✖', ...args),
};
