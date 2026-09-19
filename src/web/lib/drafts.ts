import type { AnalyzeResult, FeedInput, FeedOptions, JsonCandidate, ListCandidate, RenderOptions } from '../../shared/types';
import { domainOf } from './format';

export interface EditorState {
  draft: FeedInput;
}

export function defaultOptions(refreshMinutes = 60): FeedOptions {
  return { refreshMinutes, maxItems: 50, filters: [], fullText: { enabled: false }, request: {} };
}

/** "Korben - Tech, IA, robots…" → "Korben": page titles often append a tagline. */
export function shortTitle(title: string | null | undefined): string {
  const t = (title ?? '').trim();
  const first = t.split(/\s+[-|–—·:]\s+/)[0]?.trim() ?? '';
  return first.length >= 3 ? first : t;
}

/** The address after redirects, unless they ended on a consent or login page: then keep the one typed. */
function pageUrl(url: string, analysis: AnalyzeResult | null | undefined): string {
  if (!analysis) return url;
  return analysis.hints.redirectWall ? analysis.url : analysis.finalUrl;
}

/** A rendered analysis scrolled the page to load lazy content: the feed keeps doing the same. */
function renderFor(analysis: AnalyzeResult | null | undefined): RenderOptions {
  return analysis?.hints.rendered ? { enabled: true, scroll: true } : { enabled: false };
}

function baseDraft(url: string, analysis: AnalyzeResult | null | undefined, refreshMinutes: number): Omit<FeedInput, 'source'> {
  return {
    name: shortTitle(analysis?.title) || domainOf(url) || 'Nouveau flux',
    description: analysis?.description?.slice(0, 480) ?? '',
    siteUrl: pageUrl(url, analysis),
    iconUrl: analysis?.iconUrl ?? '',
    enabled: true,
    recipe: null,
    options: defaultOptions(refreshMinutes),
  };
}

export function htmlDraft(url: string, analysis?: AnalyzeResult | null, candidate?: ListCandidate, refreshMinutes = 60): FeedInput {
  return {
    ...baseDraft(url, analysis, refreshMinutes),
    source: {
      type: 'html',
      url: pageUrl(url, analysis),
      render: renderFor(analysis),
      itemSelector: candidate?.itemSelector ?? '',
      fields: candidate?.fields ?? {},
    },
  };
}

export function watchDraft(url: string, analysis?: AnalyzeResult | null, refreshMinutes = 60): FeedInput {
  const draft = baseDraft(url, analysis, refreshMinutes);
  return {
    ...draft,
    name: `${draft.name} · changements`,
    source: { type: 'watch', url: pageUrl(url, analysis), render: renderFor(analysis), selector: '' },
  };
}

export function jsonDraft(url: string, analysis?: AnalyzeResult | null, candidate?: JsonCandidate, refreshMinutes = 60): FeedInput {
  return {
    ...baseDraft(url, analysis, refreshMinutes),
    source: {
      type: 'json',
      url: pageUrl(url, analysis),
      method: 'GET',
      itemsPath: candidate?.itemsPath ?? '',
      fields: candidate?.fields ?? {},
      ...(analysis?.json?.embedSelector ? { embedSelector: analysis.json.embedSelector } : {}),
    },
  };
}

export function feedDraft(urls: string[], name?: string | null, analysis?: AnalyzeResult | null, refreshMinutes = 60): FeedInput {
  const first = urls[0] ?? '';
  return {
    ...baseDraft(first, analysis, refreshMinutes),
    name: name?.trim() || analysis?.title?.trim() || domainOf(first) || 'Nouveau flux',
    source: { type: 'feed', urls },
  };
}
