// Feed repository: validation, persistence, item storage and fetch history.
import {
  FIELD_KEYS,
  type FeedDetail,
  type FeedInput,
  type FeedOptions,
  type FeedSummary,
  type FeedUrls,
  type FetchHistoryEntry,
  type FieldRules,
  type FilterRule,
  type ItemData,
  type JsonFields,
  type RenderOptions,
  type RequestOptions,
  type SourceConfig,
  type StoredItem,
} from '../shared/types.js';
import { normalizeUrl } from './core/http.js';
import { all, get, run, transaction } from './db.js';
import type { OutputItem } from './output.js';
import { getSettings } from './settings.js';
import { randomId, slugify } from './util.js';

export class ValidationError extends Error {}

/** Feeds currently being refreshed (shared with the runner). */
export const runningFeeds = new Set<string>();

export interface FeedRow {
  id: string;
  slug: string;
  name: string;
  description: string;
  site_url: string;
  icon_url: string;
  source_type: string;
  source: string;
  options: string;
  recipe: string | null;
  enabled: number;
  state: string;
  created_at: number;
  updated_at: number;
  last_fetch_at: number | null;
  last_success_at: number | null;
  last_error: string | null;
  error_count: number;
  next_fetch_at: number | null;
}

// ---- Validation ---------------------------------------------------------------------------------

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function str(v: unknown, max: number, label: string): string {
  if (v == null) return '';
  if (typeof v !== 'string') throw new ValidationError(`${label} : texte attendu.`);
  const s = v.trim();
  if (s.length > max) throw new ValidationError(`${label} : ${max} caractères maximum.`);
  return s;
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

function int(v: unknown, fallback: number, min: number, max: number): number {
  const n = Math.round(Number(v));
  return v === '' || v == null || !Number.isFinite(n) ? fallback : Math.min(max, Math.max(min, n));
}

function url(v: unknown, label: string): string {
  const s = str(v, 2000, label);
  if (!s) throw new ValidationError(`${label} : adresse requise.`);
  try {
    return normalizeUrl(s);
  } catch (err) {
    throw new ValidationError(`${label} : ${(err as Error).message}`);
  }
}

function optionalUrl(v: unknown): string {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s) return '';
  try {
    return normalizeUrl(s);
  } catch {
    return '';
  }
}

function pattern(v: unknown, label: string): string | undefined {
  const s = str(v, 300, label);
  if (!s) return undefined;
  try {
    new RegExp(s);
  } catch {
    throw new ValidationError(`${label} : expression régulière invalide.`);
  }
  return s;
}

const FIELD_LABELS = { title: 'Titre', link: 'Lien', description: 'Contenu', date: 'Date', image: 'Image', author: 'Auteur' } as const;

export function renderOptions(v: unknown): RenderOptions {
  const o = obj(v);
  const out: RenderOptions = { enabled: bool(o.enabled, false) };
  const waitFor = str(o.waitFor, 300, 'Attendre l’élément');
  if (waitFor) out.waitFor = waitFor;
  if (bool(o.scroll, false)) out.scroll = true;
  const delay = int(o.delayMs, 0, 0, 15_000);
  if (delay) out.delayMs = delay;
  return out;
}

function fieldRules(v: unknown): FieldRules {
  const o = obj(v);
  const out: FieldRules = {};
  for (const key of FIELD_KEYS) {
    const r = obj(o[key]);
    const selector = str(r.selector, 500, `Sélecteur « ${FIELD_LABELS[key]} »`);
    if (!selector) continue;
    const attr = str(r.attr, 60, `Attribut « ${FIELD_LABELS[key]} »`);
    const regex = pattern(r.regex, `Expression « ${FIELD_LABELS[key]} »`);
    out[key] = { selector, ...(attr ? { attr } : {}), ...(regex ? { regex } : {}) };
  }
  return out;
}

function jsonFields(v: unknown): JsonFields {
  const o = obj(v);
  const out: JsonFields = {};
  for (const key of FIELD_KEYS) {
    const s = str(o[key], 500, `Champ « ${FIELD_LABELS[key]} »`);
    if (s) out[key] = s;
  }
  return out;
}

export function validateSource(v: unknown): SourceConfig {
  const o = obj(v);
  switch (o.type) {
    case 'html':
      return {
        type: 'html',
        url: url(o.url, 'Adresse de la page'),
        render: renderOptions(o.render),
        itemSelector: str(o.itemSelector, 500, 'Sélecteur des éléments'),
        fields: fieldRules(o.fields),
      };
    case 'json': {
      const out: SourceConfig = {
        type: 'json',
        url: url(o.url, 'Adresse de l’API'),
        method: o.method === 'POST' ? 'POST' : 'GET',
        itemsPath: str(o.itemsPath, 300, 'Chemin des éléments'),
        fields: jsonFields(o.fields),
      };
      const body = str(o.body, 20_000, 'Corps de la requête');
      if (body) out.body = body;
      const embed = str(o.embedSelector, 300, 'Élément contenant le JSON');
      if (embed) out.embedSelector = embed;
      return out;
    }
    case 'feed': {
      const list = Array.isArray(o.urls) ? o.urls : [];
      const urls = list
        .map((u, i) => str(u, 2000, `Flux n°${i + 1}`))
        .filter(Boolean)
        .map((u, i) => url(u, `Flux n°${i + 1}`));
      if (!urls.length) throw new ValidationError('Ajoutez au moins une adresse de flux.');
      if (urls.length > 30) throw new ValidationError('30 flux au maximum par fusion.');
      return { type: 'feed', urls: [...new Set(urls)] };
    }
    case 'watch': {
      const out: SourceConfig = {
        type: 'watch',
        url: url(o.url, 'Adresse de la page'),
        render: renderOptions(o.render),
        selector: str(o.selector, 500, 'Zone surveillée'),
      };
      const ignore = pattern(o.ignore, 'Texte à ignorer');
      if (ignore) out.ignore = ignore;
      return out;
    }
    default:
      throw new ValidationError('Type de source inconnu.');
  }
}

export function defaultOptions(): FeedOptions {
  return { refreshMinutes: getSettings().defaultRefreshMinutes, maxItems: 50, filters: [], fullText: { enabled: false }, request: {} };
}

const FILTER_FIELDS = ['any', 'title', 'content', 'link', 'author'] as const;

export function validateOptions(v: unknown): FeedOptions {
  const o = obj(v);
  const defaults = defaultOptions();
  const filters: FilterRule[] = (Array.isArray(o.filters) ? o.filters : []).slice(0, 50).flatMap((f) => {
    const r = obj(f);
    const isRegex = bool(r.regex, false);
    const text = isRegex ? pattern(r.pattern, 'Filtre') ?? '' : str(r.pattern, 300, 'Filtre');
    if (!text) return [];
    const field = FILTER_FIELDS.includes(r.field as FilterRule['field']) ? (r.field as FilterRule['field']) : 'any';
    return [{ mode: r.mode === 'include' ? 'include' : 'exclude', field, pattern: text, regex: isRegex }];
  });

  const rq = obj(o.request);
  const request: RequestOptions = {};
  const userAgent = str(rq.userAgent, 500, 'User-Agent');
  if (userAgent) request.userAgent = userAgent;
  const cookies = str(rq.cookies, 8000, 'Cookies');
  if (cookies) request.cookies = cookies;
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(obj(rq.headers)).slice(0, 30)) {
    const key = name.trim();
    if (!key) continue;
    if (!/^[\w-]{1,100}$/.test(key)) throw new ValidationError(`Nom d’en-tête invalide : ${name}`);
    const val = str(value, 4000, `En-tête ${key}`);
    if (val) headers[key] = val;
  }
  if (Object.keys(headers).length) request.headers = headers;
  if (rq.timeoutSec != null && rq.timeoutSec !== '') request.timeoutSec = int(rq.timeoutSec, 25, 5, 120);

  const ft = obj(o.fullText);
  const fullText: FeedOptions['fullText'] = { enabled: bool(ft.enabled, false) };
  const ftSelector = str(ft.selector, 300, 'Sélecteur du contenu complet');
  if (ftSelector) fullText.selector = ftSelector;

  return {
    refreshMinutes: int(o.refreshMinutes, defaults.refreshMinutes, 5, 10_080),
    maxItems: int(o.maxItems, 50, 1, 500),
    filters,
    fullText,
    request,
  };
}

export function validateFeedInput(v: unknown): FeedInput {
  const o = obj(v);
  const name = str(o.name, 120, 'Nom');
  if (!name) throw new ValidationError('Donnez un nom à ce flux.');
  const source = validateSource(o.source);
  if (source.type === 'html' && !source.itemSelector) throw new ValidationError('Indiquez le sélecteur des éléments à extraire.');
  return {
    name,
    slug: str(o.slug, 60, 'Identifiant') || undefined,
    description: str(o.description, 500, 'Description'),
    siteUrl: optionalUrl(o.siteUrl),
    iconUrl: optionalUrl(o.iconUrl),
    enabled: bool(o.enabled, true),
    recipe: str(o.recipe, 40, 'Recette') || null,
    source,
    options: validateOptions(o.options),
  };
}

// ---- Reading ------------------------------------------------------------------------------------

export function parseSource(row: FeedRow): SourceConfig {
  return JSON.parse(row.source) as SourceConfig;
}

export function parseOptions(row: FeedRow): FeedOptions {
  return { ...defaultOptions(), ...(JSON.parse(row.options) as Partial<FeedOptions>) };
}

export function parseState(row: FeedRow): Record<string, unknown> {
  try {
    return JSON.parse(row.state) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function feedUrls(slug: string, base: string): FeedUrls {
  const settings = getSettings();
  const query = settings.feedKeyRequired ? `?key=${encodeURIComponent(settings.feedKey)}` : '';
  const root = `${base}/f/${encodeURIComponent(slug)}`;
  return { rss: `${root}.rss${query}`, atom: `${root}.atom${query}`, json: `${root}.json${query}` };
}

interface SummaryRow extends FeedRow {
  item_count: number;
  last_item_at: number | null;
}

interface LogRow {
  feed_id: string;
  started_at: number;
  duration_ms: number;
  ok: number;
  found: number;
  added: number;
  error: string | null;
  trigger: string;
}

const SUMMARY_SQL = `
  SELECT f.*,
    (SELECT COUNT(*) FROM items i WHERE i.feed_id = f.id) AS item_count,
    (SELECT MAX(COALESCE(i.published_at, i.first_seen_at)) FROM items i WHERE i.feed_id = f.id) AS last_item_at
  FROM feeds f`;

function toHistory(r: LogRow): FetchHistoryEntry {
  return { at: r.started_at, ok: !!r.ok, found: r.found, added: r.added, ms: r.duration_ms, error: r.error, trigger: r.trigger };
}

function toSummary(row: SummaryRow, history: FetchHistoryEntry[], base: string): FeedSummary {
  const source = parseSource(row);
  const options = parseOptions(row);
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    siteUrl: row.site_url,
    iconUrl: row.icon_url,
    enabled: !!row.enabled,
    recipe: row.recipe,
    sourceType: source.type,
    sourceUrl: source.type === 'feed' ? (source.urls[0] ?? '') : source.url,
    refreshMinutes: options.refreshMinutes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastFetchAt: row.last_fetch_at,
    lastSuccessAt: row.last_success_at,
    nextFetchAt: row.next_fetch_at,
    lastError: row.last_error,
    errorCount: row.error_count,
    itemCount: row.item_count,
    lastItemAt: row.last_item_at,
    running: runningFeeds.has(row.id),
    history,
    urls: feedUrls(row.slug, base),
  };
}

export function listFeeds(base: string): FeedSummary[] {
  const rows = all<SummaryRow>(`${SUMMARY_SQL} ORDER BY f.created_at DESC`);
  const logs = all<LogRow>(
    `SELECT feed_id, started_at, duration_ms, ok, found, added, error, trigger FROM (
       SELECT l.*, ROW_NUMBER() OVER (PARTITION BY feed_id ORDER BY started_at DESC) AS rn FROM fetch_log l
     ) WHERE rn <= 30 ORDER BY started_at ASC`,
  );
  const byFeed = new Map<string, FetchHistoryEntry[]>();
  for (const l of logs) {
    const list = byFeed.get(l.feed_id) ?? [];
    list.push(toHistory(l));
    byFeed.set(l.feed_id, list);
  }
  return rows.map((r) => toSummary(r, byFeed.get(r.id) ?? [], base));
}

export function getFeedRow(id: string): FeedRow | undefined {
  return get<FeedRow>('SELECT * FROM feeds WHERE id = ?', id);
}

export function getFeedRowBySlug(slug: string): FeedRow | undefined {
  return get<FeedRow>('SELECT * FROM feeds WHERE slug = ?', slug);
}

export function getFeedDetail(id: string, base: string): FeedDetail | undefined {
  const row = get<SummaryRow>(`${SUMMARY_SQL} WHERE f.id = ?`, id);
  if (!row) return undefined;
  const history = all<LogRow>(
    'SELECT feed_id, started_at, duration_ms, ok, found, added, error, trigger FROM fetch_log WHERE feed_id = ? ORDER BY started_at DESC LIMIT 60',
    id,
  )
    .reverse()
    .map(toHistory);
  return { ...toSummary(row, history, base), source: parseSource(row), options: parseOptions(row) };
}

export function uniqueSlug(base: string, excludeId = ''): string {
  const root = slugify(base);
  let slug = root;
  for (let i = 2; get('SELECT id FROM feeds WHERE slug = ? AND id != ?', slug, excludeId); i++) slug = `${root}-${i}`;
  return slug;
}

// ---- Writing ------------------------------------------------------------------------------------

export function createFeed(input: FeedInput): string {
  const id = randomId(10);
  const now = Date.now();
  run(
    `INSERT INTO feeds (id, slug, name, description, site_url, icon_url, source_type, source, options, recipe, enabled, state, created_at, updated_at, next_fetch_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', ?, ?, ?)`,
    id,
    uniqueSlug(input.slug || input.name),
    input.name,
    input.description ?? '',
    input.siteUrl ?? '',
    input.iconUrl ?? '',
    input.source.type,
    JSON.stringify(input.source),
    JSON.stringify(input.options),
    input.recipe ?? null,
    input.enabled ? 1 : 0,
    now,
    now,
    now,
  );
  return id;
}

export function updateFeed(id: string, input: FeedInput): boolean {
  const row = getFeedRow(id);
  if (!row) return false;
  const source = JSON.stringify(input.source);
  const sourceChanged = source !== row.source;
  const now = Date.now();
  run(
    `UPDATE feeds SET slug = ?, name = ?, description = ?, site_url = ?, icon_url = ?, source_type = ?, source = ?, options = ?,
       recipe = ?, enabled = ?, state = ?, updated_at = ?, next_fetch_at = ? WHERE id = ?`,
    input.slug ? uniqueSlug(input.slug, id) : row.slug,
    input.name,
    input.description ?? '',
    input.siteUrl ?? '',
    input.iconUrl ?? '',
    input.source.type,
    source,
    JSON.stringify(input.options),
    input.recipe ?? row.recipe,
    input.enabled ? 1 : 0,
    sourceChanged ? '{}' : row.state,
    now,
    sourceChanged ? now : row.next_fetch_at,
    id,
  );
  return true;
}

export function deleteFeed(id: string): boolean {
  return Number(run('DELETE FROM feeds WHERE id = ?', id).changes) > 0;
}

export function setFeedEnabled(id: string, enabled: boolean): boolean {
  const now = Date.now();
  return Number(run('UPDATE feeds SET enabled = ?, updated_at = ?, next_fetch_at = ? WHERE id = ?', enabled ? 1 : 0, now, now, id).changes) > 0;
}

export function clearItems(id: string): void {
  run('DELETE FROM items WHERE feed_id = ?', id);
}

interface ExistingItem {
  id: number;
  title: string;
  content: string | null;
}

/** Upserts the items of one refresh. New items keep the page order through their first-seen time. */
export function storeItems(feedId: string, items: ItemData[], at: number, maxItems: number): { added: number } {
  return transaction(() => {
    // Undated items borrow the date of their nearest dated neighbour in page order, so mixed lists keep their order.
    const prev: Array<[number, number] | null> = [];
    let lastDated: [number, number] | null = null;
    items.forEach((it, i) => {
      prev.push(lastDated);
      if (it.date) lastDated = [i, it.date];
    });
    const next: Array<[number, number] | null> = new Array(items.length).fill(null);
    let nextDated: [number, number] | null = null;
    for (let i = items.length - 1; i >= 0; i--) {
      next[i] = nextDated;
      const d = items[i].date;
      if (d) nextDated = [i, d];
    }
    const firstSeen = (index: number, addedSoFar: number): number => {
      if (!items[index].date) {
        const p = prev[index];
        const n = next[index];
        if (p) return Math.min(at, p[1] - (index - p[0]) * 1000);
        if (n) return Math.min(at, n[1] + (n[0] - index) * 1000);
      }
      return at - addedSoFar * 1000;
    };

    let added = 0;
    for (const [index, it] of items.entries()) {
      const existing = get<ExistingItem>('SELECT id, title, content FROM items WHERE feed_id = ? AND guid = ?', feedId, it.guid);
      if (existing) {
        const changed = existing.title !== it.title || (it.content !== null && existing.content !== it.content);
        run(
          `UPDATE items SET last_seen_at = ?, title = ?, link = ?, content = COALESCE(?, content), summary = COALESCE(?, summary),
             image = COALESCE(?, image), author = COALESCE(?, author), published_at = COALESCE(?, published_at),
             updated_at = CASE WHEN ? THEN ? ELSE updated_at END WHERE id = ?`,
          at, it.title, it.link, it.content, it.summary, it.image, it.author, it.date, changed ? 1 : 0, at, existing.id,
        );
      } else {
        run(
          `INSERT INTO items (feed_id, guid, title, link, content, summary, image, author, published_at, first_seen_at, last_seen_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          feedId, it.guid, it.title, it.link, it.content, it.summary, it.image, it.author, it.date, firstSeen(index, added), at, at,
        );
        added++;
      }
    }
    const keep = Math.max(maxItems * 2, 100);
    run(
      `DELETE FROM items WHERE feed_id = ? AND last_seen_at < ? AND id NOT IN (
         SELECT id FROM items WHERE feed_id = ? ORDER BY COALESCE(published_at, first_seen_at) DESC, id DESC LIMIT ?
       )`,
      feedId, at, feedId, keep,
    );
    return { added };
  });
}

interface ItemRow {
  id: number;
  guid: string;
  title: string;
  link: string | null;
  content: string | null;
  full_content: string | null;
  summary: string | null;
  image: string | null;
  author: string | null;
  published_at: number | null;
  first_seen_at: number;
}

const ITEM_ORDER = 'ORDER BY COALESCE(published_at, first_seen_at) DESC, id DESC';

export function listItems(feedId: string, limit: number): StoredItem[] {
  return all<ItemRow>(
    `SELECT id, guid, title, link, content, full_content, summary, image, author, published_at, first_seen_at FROM items WHERE feed_id = ? ${ITEM_ORDER} LIMIT ?`,
    feedId,
    limit,
  ).map((r) => ({
    id: r.id,
    guid: r.guid,
    title: r.title,
    link: r.link,
    content: r.full_content ?? r.content,
    summary: r.summary,
    image: r.image,
    author: r.author,
    date: r.published_at,
    firstSeenAt: r.first_seen_at,
    hasFullText: !!r.full_content,
  }));
}

export function outputItems(feedId: string, limit: number): OutputItem[] {
  return listItems(feedId, limit).map((i) => ({
    guid: i.guid,
    title: i.title,
    link: i.link,
    content: i.content,
    summary: i.summary,
    image: i.image,
    author: i.author,
    date: i.date ?? i.firstSeenAt,
  }));
}

export function pendingFullText(feedId: string, limit: number): Array<{ id: number; link: string }> {
  return all<{ id: number; link: string }>(
    `SELECT id, link FROM items WHERE feed_id = ? AND full_status IS NULL AND link IS NOT NULL ORDER BY first_seen_at DESC LIMIT ?`,
    feedId,
    limit,
  );
}

export function saveFullText(itemId: number, content: string | null, status: 'ok' | 'empty' | 'error'): void {
  run('UPDATE items SET full_content = ?, full_status = ? WHERE id = ?', content, status, itemId);
}

export function recordFetch(
  feedId: string,
  e: { startedAt: number; durationMs: number; ok: boolean; found: number; kept: number; added: number; error: string | null; trigger: string },
): void {
  run(
    'INSERT INTO fetch_log (feed_id, started_at, duration_ms, ok, found, kept, added, error, trigger) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    feedId, e.startedAt, e.durationMs, e.ok ? 1 : 0, e.found, e.kept, e.added, e.error, e.trigger,
  );
  run(
    'DELETE FROM fetch_log WHERE feed_id = ? AND id NOT IN (SELECT id FROM fetch_log WHERE feed_id = ? ORDER BY started_at DESC LIMIT 200)',
    feedId,
    feedId,
  );
}

export function markFeedRun(
  id: string,
  r: { ok: boolean; at: number; error: string | null; nextFetchAt: number; state?: Record<string, unknown>; siteUrl?: string | null; iconUrl?: string | null },
): void {
  if (!r.ok) {
    run('UPDATE feeds SET last_fetch_at = ?, last_error = ?, error_count = error_count + 1, next_fetch_at = ? WHERE id = ?', r.at, r.error, r.nextFetchAt, id);
    return;
  }
  run(
    `UPDATE feeds SET last_fetch_at = ?, last_success_at = ?, last_error = NULL, error_count = 0, next_fetch_at = ?,
       state = COALESCE(?, state),
       site_url = CASE WHEN site_url = '' AND ? IS NOT NULL THEN ? ELSE site_url END,
       icon_url = CASE WHEN icon_url = '' AND ? IS NOT NULL THEN ? ELSE icon_url END
     WHERE id = ?`,
    r.at, r.at, r.nextFetchAt, r.state ? JSON.stringify(r.state) : null,
    r.siteUrl ?? null, r.siteUrl ?? null, r.iconUrl ?? null, r.iconUrl ?? null, id,
  );
}

export function countStats(): { feeds: number; items: number } {
  const f = get<{ n: number }>('SELECT COUNT(*) AS n FROM feeds');
  const i = get<{ n: number }>('SELECT COUNT(*) AS n FROM items');
  return { feeds: f?.n ?? 0, items: i?.n ?? 0 };
}
