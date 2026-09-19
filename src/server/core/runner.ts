// Refreshes one feed: extraction, storage, full text, history.
import type { FeedOptions } from '../../shared/types.js';
import {
  getFeedRow,
  markFeedRun,
  parseOptions,
  parseSource,
  parseState,
  pendingFullText,
  recordFetch,
  runningFeeds,
  saveFullText,
  storeItems,
} from '../feeds.js';
import { errorMessage, log, sleep } from '../util.js';
import { fetchFullText } from './fulltext.js';
import { runSource } from './source.js';

export interface RefreshResult {
  ok: boolean;
  found: number;
  kept: number;
  added: number;
  error: string | null;
  warnings: string[];
  durationMs: number;
}

const inflight = new Map<string, Promise<RefreshResult>>();

/** Next refresh time, backing off (up to ×8) after repeated failures. */
export function nextFetchTime(refreshMinutes: number, errorCount: number): number {
  const factor = errorCount <= 1 ? 1 : Math.min(2 ** (errorCount - 1), 8);
  const delay = Math.min(refreshMinutes * 60_000 * factor, 24 * 3600_000);
  return Date.now() + Math.round(delay * (0.95 + Math.random() * 0.1));
}

export function refreshFeed(id: string, trigger: string): Promise<RefreshResult> {
  const existing = inflight.get(id);
  if (existing) return existing;
  runningFeeds.add(id);
  const promise = doRefresh(id, trigger).finally(() => {
    inflight.delete(id);
    runningFeeds.delete(id);
  });
  inflight.set(id, promise);
  return promise;
}

async function fillFullText(feedId: string, options: FeedOptions): Promise<void> {
  for (const item of pendingFullText(feedId, 10)) {
    try {
      const html = await fetchFullText(item.link, { selector: options.fullText.selector, request: options.request });
      saveFullText(item.id, html, html ? 'ok' : 'empty');
    } catch {
      saveFullText(item.id, null, 'error');
    }
    await sleep(500);
  }
}

async function doRefresh(id: string, trigger: string): Promise<RefreshResult> {
  const row = getFeedRow(id);
  if (!row) throw new Error('Flux introuvable.');
  const source = parseSource(row);
  const options = parseOptions(row);
  const started = Date.now();
  try {
    const result = await runSource(source, options, { mode: 'run', state: parseState(row) });
    if (result.found === 0 && source.type !== 'watch') {
      throw new Error(result.warnings[0] ?? 'Aucun élément trouvé sur la page.');
    }
    const { added } = storeItems(id, result.items.slice(0, 500), started, options.maxItems);
    if (options.fullText.enabled) await fillFullText(id, options);
    const durationMs = Date.now() - started;
    recordFetch(id, { startedAt: started, durationMs, ok: true, found: result.found, kept: result.items.length, added, error: null, trigger });
    markFeedRun(id, {
      ok: true,
      at: started,
      error: null,
      nextFetchAt: nextFetchTime(options.refreshMinutes, 0),
      state: source.type === 'watch' ? result.state : undefined,
      siteUrl: result.siteUrl,
      iconUrl: result.iconUrl,
    });
    return { ok: true, found: result.found, kept: result.items.length, added, error: null, warnings: result.warnings, durationMs };
  } catch (err) {
    const message = errorMessage(err);
    const durationMs = Date.now() - started;
    recordFetch(id, { startedAt: started, durationMs, ok: false, found: 0, kept: 0, added: 0, error: message, trigger });
    markFeedRun(id, { ok: false, at: started, error: message, nextFetchAt: nextFetchTime(options.refreshMinutes, row.error_count + 1) });
    log.warn(`Flux « ${row.name} » : ${message}`);
    return { ok: false, found: 0, kept: 0, added: 0, error: message, warnings: [], durationMs };
  }
}
