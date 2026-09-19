import type { RequestOptions } from '../../shared/types.js';
import { getSettings } from '../settings.js';
import { HttpError } from '../util.js';
import { cookieHeader } from './consent.js';

export interface FetchResult {
  url: string;
  finalUrl: string;
  status: number;
  contentType: string;
  body: string;
}

const MAX_BYTES = 12 * 1024 * 1024;

export const ACCEPT_HTML = 'text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.7';
export const ACCEPT_FEED = 'application/rss+xml,application/atom+xml,application/feed+json,application/xml;q=0.9,text/xml;q=0.9,*/*;q=0.7';

/** Normalizes user input into an absolute http(s) URL, or throws. */
export function normalizeUrl(input: string): string {
  let value = String(input ?? '').trim();
  if (!value) throw new Error('Adresse vide.');
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) value = 'https://' + value.replace(/^\/+/, '');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Adresse invalide.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Seules les adresses http et https sont prises en charge.');
  return url.href;
}

export function buildHeaders(url: string, request: RequestOptions | undefined, accept: string): Record<string, string> {
  const settings = getSettings();
  const headers: Record<string, string> = {
    'user-agent': request?.userAgent || settings.userAgent,
    accept,
    'accept-language': settings.acceptLanguage,
  };
  const cookie = cookieHeader(url, request?.cookies);
  if (cookie) headers.cookie = cookie;
  for (const [name, value] of Object.entries(request?.headers ?? {})) {
    if (name.trim() && value != null && value !== '') headers[name.trim().toLowerCase()] = String(value);
  }
  return headers;
}

async function readLimited(res: Response): Promise<Uint8Array> {
  if (!res.body) return new Uint8Array();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new Error('Page trop volumineuse (plus de 12 Mo).');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/** Decodes bytes using the charset from the header, a BOM, or a <meta>/<?xml?> declaration. */
export function decodeBody(buf: Uint8Array, contentType: string): string {
  let charset = /charset=["']?([\w-]+)/i.exec(contentType)?.[1];
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) charset = 'utf-8';
  if (!charset) {
    const head = new TextDecoder('latin1').decode(buf.subarray(0, 4096));
    charset =
      /<meta[^>]+charset=["']?([\w-]+)/i.exec(head)?.[1] ?? /<\?xml[^>]+encoding=["']([\w-]+)["']/i.exec(head)?.[1];
  }
  try {
    return new TextDecoder(charset || 'utf-8').decode(buf);
  } catch {
    return new TextDecoder('utf-8').decode(buf);
  }
}

export async function fetchText(
  url: string,
  opts: { request?: RequestOptions; accept?: string; method?: 'GET' | 'POST'; body?: string; timeoutMs?: number } = {},
): Promise<FetchResult> {
  const timeoutMs = opts.timeoutMs ?? (opts.request?.timeoutSec ? opts.request.timeoutSec * 1000 : 25_000);
  const headers = buildHeaders(url, opts.request, opts.accept ?? ACCEPT_HTML);
  const method = opts.method ?? 'GET';
  if (method === 'POST' && opts.body && !headers['content-type']) headers['content-type'] = 'application/json';
  const res = await fetch(url, {
    method,
    headers,
    body: method === 'POST' ? opts.body : undefined,
    redirect: 'follow',
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    await res.body?.cancel().catch(() => undefined);
    throw new HttpError(res.status, url);
  }
  const contentType = res.headers.get('content-type') ?? '';
  const body = decodeBody(await readLimited(res), contentType);
  return { url, finalUrl: res.url || url, status: res.status, contentType, body };
}
