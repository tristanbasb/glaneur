// "Paste a URL" analysis: existing feeds, matching recipes, detected lists, JSON candidates.
import { detectLists } from '../shared/detect.js';
import type { AnalyzeResult, DiscoveredFeed, JsonCandidate, ListCandidate } from '../shared/types.js';
import { browserPath } from './core/browser.js';
import { wallRedirect } from './core/consent.js';
import { feedLinksFromHtml, probeCommonFeeds } from './core/discover.js';
import { cheerioAdapter } from './core/dom.js';
import { extractHtmlItems, loadHtml, pageMeta } from './core/extract-html.js';
import { detectJsonLists, extractJsonItems, parseJsonBody } from './core/extract-json.js';
import { parseFeed } from './core/feedparse.js';
import { normalizeUrl } from './core/http.js';
import { normalizeItems } from './core/normalize.js';
import { isFeedContent, isJsonContent, loadPage } from './core/pages.js';
import { looksJsRendered } from './core/source.js';
import { matchRecipes } from './recipes.js';

function jsonCandidates(root: unknown, baseUrl: string): JsonCandidate[] {
  return detectJsonLists(root)
    .map((c) => {
      const items = normalizeItems(extractJsonItems(root, c, null, 40), baseUrl);
      return { itemsPath: c.itemsPath, fields: c.fields, count: c.count, sample: items.slice(0, 5) };
    })
    .filter((c) => c.sample.length > 0);
}

function rankFeeds(feeds: DiscoveredFeed[]): DiscoveredFeed[] {
  const isComments = (f: DiscoveredFeed) => /comment/i.test(`${f.url} ${f.title ?? ''}`);
  return [...feeds].sort((a, b) => Number(isComments(a)) - Number(isComments(b)));
}

export async function analyzeUrl(input: string, opts: { render: boolean }): Promise<AnalyzeResult> {
  const url = normalizeUrl(input);
  const page = await loadPage(url, { render: opts.render ? { enabled: true, scroll: true } : undefined, useCache: true });
  const result: AnalyzeResult = {
    url,
    finalUrl: page.finalUrl,
    kind: 'html',
    title: null,
    description: null,
    iconUrl: null,
    existingFeeds: [],
    recipes: matchRecipes(page.finalUrl).length ? matchRecipes(page.finalUrl) : matchRecipes(url),
    candidates: [],
    json: null,
    feed: null,
    hints: { needsRender: false, browserAvailable: !!browserPath(), rendered: page.rendered, redirectWall: wallRedirect(url, page.finalUrl) },
  };

  if (!page.rendered && isFeedContent(page)) {
    const feed = parseFeed(page.body, page.finalUrl);
    return {
      ...result,
      kind: 'feed',
      title: feed.title,
      description: feed.description,
      iconUrl: feed.iconUrl,
      feed: { title: feed.title, itemCount: feed.items.length },
      existingFeeds: [{ url: page.finalUrl, title: feed.title, format: feed.format }],
    };
  }

  if (!page.rendered && isJsonContent(page)) {
    return { ...result, kind: 'json', json: { candidates: jsonCandidates(parseJsonBody(page.body), page.finalUrl) } };
  }

  const $ = loadHtml(page.body);
  const meta = pageMeta($, page.finalUrl);
  const body = $('body').get(0);
  const lists = body ? detectLists(cheerioAdapter($), body, 5) : [];
  const candidates: ListCandidate[] = lists
    .map((list) => {
      const raw = extractHtmlItems($, { itemSelector: list.selector, fields: list.fields }, meta.lang, 60);
      const items = normalizeItems(raw, meta.baseUrl);
      return { itemSelector: list.selector, fields: list.fields, count: raw.length, score: list.score, sample: items.slice(0, 5) };
    })
    .filter((c) => c.sample.length > 0 && c.count >= 2 && (c.fields.title || c.fields.link));

  let existingFeeds = feedLinksFromHtml($, meta.baseUrl);
  if (!existingFeeds.length && !page.rendered) existingFeeds = await probeCommonFeeds(page.finalUrl).catch(() => []);

  let json: AnalyzeResult['json'] = null;
  const nextData = $('script#__NEXT_DATA__').html();
  if (nextData) {
    try {
      const found = jsonCandidates(JSON.parse(nextData), page.finalUrl);
      if (found.length) json = { candidates: found, embedSelector: 'script#__NEXT_DATA__' };
    } catch {
      // not usable
    }
  }

  return {
    ...result,
    title: meta.title,
    description: meta.description,
    iconUrl: meta.iconUrl,
    existingFeeds: rankFeeds(existingFeeds),
    candidates,
    json,
    hints: { ...result.hints, needsRender: !page.rendered && (candidates.length === 0 || looksJsRendered($)) },
  };
}
