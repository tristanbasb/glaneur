// Runs any source type and returns normalized, filtered items.
import type { FeedOptions, ItemData, SourceConfig } from '../../shared/types.js';
import { errorMessage } from '../util.js';
import { extractHtmlItems, loadHtml, pageMeta, type RawItem } from './extract-html.js';
import { extractJsonItems, jsonFromHtml, parseJsonBody } from './extract-json.js';
import { parseFeed } from './feedparse.js';
import { ACCEPT_FEED, normalizeUrl } from './http.js';
import { applyFilters, normalizeItems } from './normalize.js';
import { loadPage } from './pages.js';
import { runWatch, type WatchState } from './watch.js';
import type { CheerioAPI } from 'cheerio';

export interface SourceRunContext {
  mode: 'run' | 'preview';
  state?: Record<string, unknown>;
  useCache?: boolean;
}

export interface SourceRunResult {
  items: ItemData[];
  found: number;
  pageTitle: string | null;
  finalUrl: string | null;
  siteUrl: string | null;
  iconUrl: string | null;
  description: string | null;
  rendered: boolean;
  warnings: string[];
  state?: Record<string, unknown>;
}

/** Heuristic: the static HTML is an empty shell filled by JavaScript. */
export function looksJsRendered($: CheerioAPI): boolean {
  const body = $('body').clone();
  body.find('script, style, noscript, template, svg').remove();
  const textLength = body.text().replace(/\s+/g, ' ').trim().length;
  const shell = $('#root, #app, #__next, #__nuxt, [data-reactroot], app-root, #svelte').length > 0;
  const noscriptHint = /javascript/i.test($('noscript').text());
  return textLength < 600 && (shell || noscriptHint || $('script').length > 3);
}

function origin(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

export async function runSource(source: SourceConfig, options: FeedOptions, ctx: SourceRunContext): Promise<SourceRunResult> {
  const warnings: string[] = [];
  const request = options.request;
  let items: ItemData[] = [];
  let result: Omit<SourceRunResult, 'items' | 'found' | 'warnings'>;

  switch (source.type) {
    case 'html': {
      const url = normalizeUrl(source.url);
      if (!source.itemSelector.trim()) throw new Error('Indiquez le sélecteur des éléments à extraire.');
      const page = await loadPage(url, { render: source.render, request, useCache: ctx.useCache, lightweight: ctx.mode === 'run' });
      const $ = loadHtml(page.body);
      const meta = pageMeta($, page.finalUrl);
      const raw = extractHtmlItems($, source, meta.lang);
      if (!raw.length) {
        let msg = `Aucun élément ne correspond à « ${source.itemSelector} ».`;
        if (!page.rendered && looksJsRendered($)) msg += ' La page semble générée en JavaScript : activez le rendu JavaScript.';
        warnings.push(msg);
      }
      items = normalizeItems(raw, meta.baseUrl);
      result = { pageTitle: meta.title, finalUrl: page.finalUrl, siteUrl: origin(page.finalUrl), iconUrl: meta.iconUrl, description: meta.description, rendered: page.rendered };
      break;
    }
    case 'json': {
      const url = normalizeUrl(source.url);
      let root: unknown;
      let finalUrl = url;
      if (source.embedSelector?.trim()) {
        const page = await loadPage(url, { request, useCache: ctx.useCache });
        root = jsonFromHtml(page.body, source.embedSelector.trim());
        finalUrl = page.finalUrl;
      } else {
        const page = await loadPage(url, {
          request,
          method: source.method,
          body: source.body,
          accept: 'application/json,text/plain;q=0.9,*/*;q=0.5',
          useCache: ctx.useCache,
        });
        root = parseJsonBody(page.body);
        finalUrl = page.finalUrl;
      }
      items = normalizeItems(extractJsonItems(root, source, null), finalUrl);
      result = { pageTitle: null, finalUrl, siteUrl: origin(finalUrl), iconUrl: null, description: null, rendered: false };
      break;
    }
    case 'feed': {
      const urls = source.urls.map((u) => u.trim()).filter(Boolean).map(normalizeUrl);
      if (!urls.length) throw new Error('Ajoutez au moins une adresse de flux.');
      const settled = await Promise.allSettled(
        urls.map(async (u) => {
          const page = await loadPage(u, { request, accept: ACCEPT_FEED, useCache: ctx.useCache });
          return { page, feed: parseFeed(page.body, page.finalUrl) };
        }),
      );
      const ok = settled.flatMap((s) => (s.status === 'fulfilled' ? [s.value] : []));
      settled.forEach((s, i) => {
        if (s.status === 'rejected') warnings.push(`${urls[i]} : ${errorMessage(s.reason)}`);
      });
      if (!ok.length) throw (settled[0] as PromiseRejectedResult).reason;
      items = ok.flatMap(({ page, feed }) => normalizeItems(feed.items, page.finalUrl));
      if (ok.length > 1) items.sort((a, b) => (b.date ?? 0) - (a.date ?? 0));
      const single = ok.length === 1 ? ok[0].feed : null;
      result = {
        pageTitle: single?.title ?? null,
        finalUrl: ok[0].page.finalUrl,
        siteUrl: single?.link ?? origin(ok[0].page.finalUrl),
        iconUrl: single?.iconUrl ?? null,
        description: single?.description ?? null,
        rendered: false,
      };
      break;
    }
    case 'watch': {
      const url = normalizeUrl(source.url);
      const page = await loadPage(url, { render: source.render, request, useCache: ctx.useCache, lightweight: ctx.mode === 'run' });
      const $ = loadHtml(page.body);
      const meta = pageMeta($, page.finalUrl);
      const watched = runWatch($, source, (ctx.state ?? {}) as WatchState, page.finalUrl, ctx.mode);
      items = normalizeItems(
        watched.items.map((i): RawItem => ({ ...i, trusted: true })),
        page.finalUrl,
      );
      result = {
        pageTitle: meta.title,
        finalUrl: page.finalUrl,
        siteUrl: page.finalUrl,
        iconUrl: meta.iconUrl,
        description: meta.description,
        rendered: page.rendered,
        state: watched.state as Record<string, unknown>,
      };
      break;
    }
    default:
      throw new Error('Type de source inconnu.');
  }

  const found = items.length;
  const kept = applyFilters(items, options.filters);
  if (found && !kept.length) warnings.push(`Les filtres ont écarté les ${found} éléments trouvés.`);
  return { ...result, items: kept, found, warnings };
}
