// Turns raw extracted values into clean items, then applies the user's filters.
import type { FilterRule, ItemData } from '../../shared/types.js';
import { sha1, truncate } from '../util.js';
import type { RawItem } from './extract-html.js';
import { absolutize, cleanInline, htmlToText, sanitizeContent, textToHtml } from './html.js';

const TRACKING_PARAM = /^(utm_\w+|fbclid|gclid|mc_cid|mc_eid|xtor|at_medium|at_campaign|at_link|ref_src|igshid)$/i;

export function canonicalLink(link: string): string {
  try {
    const u = new URL(link);
    u.hash = '';
    for (const key of [...u.searchParams.keys()]) if (TRACKING_PARAM.test(key)) u.searchParams.delete(key);
    return u.href;
  } catch {
    return link;
  }
}

export function deriveTitle(text: string): string {
  const firstLine = text.split('\n').map((l) => l.trim()).find(Boolean) ?? '';
  const sentence = /^(.{20,140}?[.!?…])(\s|$)/.exec(firstLine)?.[1];
  return truncate(sentence ?? firstLine, 120);
}

function titleFromLink(link: string): string {
  try {
    const u = new URL(link);
    const last = decodeURIComponent(u.pathname.replace(/\/+$/, '').split('/').pop() ?? '');
    return last.replace(/\.\w{2,5}$/, '').replace(/[-_]+/g, ' ').trim() || u.hostname;
  } catch {
    return link;
  }
}

export function normalizeItems(raw: RawItem[], baseUrl: string): ItemData[] {
  const seen = new Set<string>();
  const out: ItemData[] = [];
  for (const r of raw) {
    const link = absolutize(r.link, baseUrl);
    let content: string | null = null;
    if (r.content) {
      if (r.trusted) content = r.content;
      else content = (r.contentIsHtml ? sanitizeContent(r.content, baseUrl) : textToHtml(r.content)) || null;
    }
    const text = content ? htmlToText(content) : '';
    let title = cleanInline(r.title);
    // A long run of characters without any space is a token or tracking id, not a title.
    if (title.length > 50 && !/\s/.test(title)) title = '';
    if (!title && text) title = deriveTitle(text);
    if (!title && link) title = titleFromLink(link);
    if (!title) continue;

    let guid = cleanInline(r.guid) || (link ? canonicalLink(link) : '');
    if (!guid || seen.has(guid)) guid = sha1(`${link ?? ''}|${title}|${text.slice(0, 300)}`);
    if (seen.has(guid)) continue;
    seen.add(guid);

    out.push({
      guid,
      title: truncate(title, 300),
      link,
      content,
      summary: text ? truncate(text.replace(/\s+/g, ' '), 400) : null,
      image: absolutize(r.image, baseUrl),
      author: cleanInline(r.author) || null,
      date: r.date,
      found: r.found,
    });
  }
  return out;
}

function fold(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

export function applyFilters(items: ItemData[], rules: FilterRule[] | undefined): ItemData[] {
  const active = (rules ?? []).filter((r) => r.pattern?.trim());
  if (!active.length) return items;
  const compiled = active.map((r) => {
    let re: RegExp | null = null;
    if (r.regex) {
      try {
        re = new RegExp(r.pattern, 'i');
      } catch {
        re = null;
      }
    }
    return { ...r, re, needle: fold(r.pattern.trim()) };
  });
  const textCache = new Map<ItemData, string>();
  const bodyText = (it: ItemData) => {
    if (!textCache.has(it)) textCache.set(it, it.content ? htmlToText(it.content) : '');
    return textCache.get(it)!;
  };
  const haystack = (it: ItemData, field: FilterRule['field']) => {
    switch (field) {
      case 'title':
        return it.title;
      case 'link':
        return it.link ?? '';
      case 'author':
        return it.author ?? '';
      case 'content':
        return bodyText(it);
      default:
        return `${it.title}\n${bodyText(it)}\n${it.link ?? ''}\n${it.author ?? ''}`;
    }
  };
  const test = (c: (typeof compiled)[number], it: ItemData) => {
    const h = haystack(it, c.field);
    return c.regex ? !!c.re?.test(h) : fold(h).includes(c.needle);
  };
  const includes = compiled.filter((c) => c.mode === 'include');
  const excludes = compiled.filter((c) => c.mode === 'exclude');
  return items.filter((it) => !excludes.some((c) => test(c, it)) && (!includes.length || includes.some((c) => test(c, it))));
}
