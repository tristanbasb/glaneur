// Finds feeds a site already publishes.
import type { CheerioAPI } from 'cheerio';
import type { DiscoveredFeed } from '../../shared/types.js';
import { absolutize, cleanInline } from './html.js';
import { ACCEPT_FEED, fetchText } from './http.js';
import { isFeedContent } from './pages.js';

export function feedLinksFromHtml($: CheerioAPI, baseUrl: string): DiscoveredFeed[] {
  const out: DiscoveredFeed[] = [];
  const seen = new Set<string>();
  for (const el of $('link[href]').toArray()) {
    const rel = (el.attribs.rel ?? '').toLowerCase();
    if (!/(^|\s)(alternate|feed)(\s|$)/.test(rel)) continue;
    const type = (el.attribs.type ?? '').toLowerCase();
    let format: DiscoveredFeed['format'] | null = null;
    if (type.includes('rss')) format = 'rss';
    else if (type.includes('atom')) format = 'atom';
    else if (type.includes('feed+json')) format = 'json';
    if (!format) continue;
    const url = absolutize(el.attribs.href, baseUrl);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push({ url, title: cleanInline(el.attribs.title) || null, format });
  }
  return out;
}

function feedTitle(body: string): string | null {
  const m = /<title[^>]*>\s*(?:<!\[CDATA\[)?([\s\S]{1,160}?)(?:\]\]>)?\s*<\/title>/i.exec(body);
  if (!m) return null;
  return (
    m[1]
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#0?39;|&apos;/g, "'")
      .trim() || null
  );
}

/** Tries the usual feed locations when the page does not advertise one. */
export async function probeCommonFeeds(pageUrl: string): Promise<DiscoveredFeed[]> {
  const page = new URL(pageUrl);
  const candidates = new Set(['/feed', '/rss', '/rss.xml', '/feed.xml', '/atom.xml', '/index.xml', '/feed.json'].map((p) => page.origin + p));
  const path = page.pathname.replace(/\/+$/, '');
  if (path) candidates.add(`${page.origin}${path}/feed`);

  const results = await Promise.allSettled(
    [...candidates].map(async (url): Promise<DiscoveredFeed | null> => {
      const r = await fetchText(url, { accept: ACCEPT_FEED, timeoutMs: 6000 });
      if (!isFeedContent(r)) return null;
      const head = r.body.slice(0, 800);
      const format = /<feed[\s>]/i.test(head) ? 'atom' : /jsonfeed/i.test(head) ? 'json' : 'rss';
      return { url: r.finalUrl, title: format === 'json' ? null : feedTitle(r.body), format };
    }),
  );
  const out: DiscoveredFeed[] = [];
  const seen = new Set<string>();
  for (const r of results) {
    if (r.status !== 'fulfilled' || !r.value || seen.has(r.value.url)) continue;
    seen.add(r.value.url);
    out.push(r.value);
  }
  return out;
}
