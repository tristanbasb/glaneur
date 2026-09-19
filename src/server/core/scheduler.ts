import { config } from '../config.js';
import { all } from '../db.js';
import { runningFeeds } from '../feeds.js';
import { log, Semaphore } from '../util.js';
import { refreshFeed } from './runner.js';

const queue = new Semaphore(config.concurrency);
const queued = new Set<string>();
let timer: NodeJS.Timeout | null = null;

function tick(): void {
  let due: Array<{ id: string }>;
  try {
    due = all<{ id: string }>(
      'SELECT id FROM feeds WHERE enabled = 1 AND (next_fetch_at IS NULL OR next_fetch_at <= ?) ORDER BY COALESCE(next_fetch_at, 0) LIMIT 50',
      Date.now(),
    );
  } catch (err) {
    log.error('Planificateur :', err);
    return;
  }
  for (const { id } of due) {
    if (queued.has(id) || runningFeeds.has(id)) continue;
    queued.add(id);
    queue
      .use(() => refreshFeed(id, 'schedule'))
      .catch((err) => log.error('Actualisation planifiée :', err))
      .finally(() => queued.delete(id));
  }
}

export function startScheduler(): void {
  if (timer) return;
  setTimeout(tick, 5000);
  timer = setInterval(tick, 20_000);
}

export function stopScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
