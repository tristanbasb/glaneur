// Loads a page by plain HTTP or through Chromium, with a small in-memory cache for the editor.
import type { RenderOptions, RequestOptions } from '../../shared/types.js';
import { renderPage } from './browser.js';
import { ChallengeError, isChallengePage } from './challenge.js';
import { ACCEPT_HTML, fetchText } from './http.js';

export interface LoadedPage {
  url: string;
  finalUrl: string;
  contentType: string;
  body: string;
  rendered: boolean;
  fetchedAt: number;
}

export interface LoadOptions {
  render?: RenderOptions;
  request?: RequestOptions;
  method?: 'GET' | 'POST';
  body?: string;
  accept?: string;
  /** Reuse a recent copy (editor previews). Scheduled refreshes always fetch. */
  useCache?: boolean;
  /** Render without images and fonts: faster, for scheduled refreshes that nobody looks at. */
  lightweight?: boolean;
}

const TTL_MS = 10 * 60_000;
const MAX_CHARS = 40_000_000;
const cache = new Map<string, LoadedPage>();
let cachedChars = 0;

function remember(key: string, page: LoadedPage) {
  const previous = cache.get(key);
  if (previous) {
    cachedChars -= previous.body.length;
    cache.delete(key);
  }
  cache.set(key, page);
  cachedChars += page.body.length;
  for (const [k, v] of cache) {
    if (cachedChars <= MAX_CHARS && cache.size <= 30) break;
    cache.delete(k);
    cachedChars -= v.body.length;
  }
}

export async function loadPage(url: string, opts: LoadOptions = {}): Promise<LoadedPage> {
  const render = opts.render?.enabled ? opts.render : null;
  const lightweight = !!(render && opts.lightweight);
  // No request options and an empty set fetch the same page: the analysis and the editor then share one render.
  const request = opts.request && Object.keys(opts.request).length ? opts.request : null;
  const key = JSON.stringify([url, render, lightweight, request, opts.method ?? 'GET', opts.body ?? null, opts.accept ?? null]);
  if (opts.useCache) {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.fetchedAt < TTL_MS) return hit;
  }
  let page: LoadedPage;
  if (render) {
    const r = await renderPage(url, render, opts.request, { lightweight });
    page = { url, finalUrl: r.finalUrl, contentType: 'text/html; charset=utf-8', body: r.html, rendered: true, fetchedAt: Date.now() };
  } else {
    const r = await fetchText(url, { request: opts.request, method: opts.method, body: opts.body, accept: opts.accept ?? ACCEPT_HTML });
    page = { url, finalUrl: r.finalUrl, contentType: r.contentType, body: r.body, rendered: false, fetchedAt: Date.now() };
  }
  // An anti-robot check page is not the page asked for: say so rather than extract from it.
  if (isChallengePage(page.body)) throw new ChallengeError();
  remember(key, page);
  return page;
}

export function clearPageCache(): void {
  cache.clear();
  cachedChars = 0;
}

export function isJsonContent(page: Pick<LoadedPage, 'contentType' | 'body'>): boolean {
  if (/json/i.test(page.contentType)) return true;
  const head = page.body.trimStart().slice(0, 1);
  return (head === '{' || head === '[') && !/html|xml/i.test(page.contentType);
}

export function isFeedContent(page: Pick<LoadedPage, 'contentType' | 'body'>): boolean {
  const head = page.body.trimStart().slice(0, 600);
  if (/<rss[\s>]|<feed[\s>]|<rdf:RDF[\s>]/i.test(head)) return true;
  if (/(rss|atom)\+xml/i.test(page.contentType)) return true;
  return /jsonfeed\.org\/version/i.test(page.body.slice(0, 400));
}
