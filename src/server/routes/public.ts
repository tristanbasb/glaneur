import type { FastifyInstance } from 'fastify';
import { isAuthenticated } from '../auth.js';
import { refreshFeed } from '../core/runner.js';
import { getFeedRowBySlug, outputItems, parseOptions } from '../feeds.js';
import { type OutputFeed, renderAtom, renderJsonFeed, renderRss } from '../output.js';
import { baseUrl } from '../request.js';
import { getSettings } from '../settings.js';
import { sha1, sleep } from '../util.js';

const TYPES: Record<string, string> = {
  rss: 'application/rss+xml; charset=utf-8',
  xml: 'application/rss+xml; charset=utf-8',
  atom: 'application/atom+xml; charset=utf-8',
  json: 'application/feed+json; charset=utf-8',
};

export async function publicRoutes(app: FastifyInstance) {
  app.get<{ Params: { file: string }; Querystring: { key?: string } }>('/f/:file', async (req, reply) => {
    const match = /^(.+)\.(rss|xml|atom|json)$/.exec(req.params.file);
    reply.header('x-robots-tag', 'noindex');
    if (!match) return reply.code(404).type('text/plain; charset=utf-8').send('Flux introuvable.');
    const [, slug, ext] = match;

    const settings = getSettings();
    if (settings.feedKeyRequired && req.query.key !== settings.feedKey && !isAuthenticated(req)) {
      return reply.code(401).type('text/plain; charset=utf-8').send('Clé d’accès manquante ou invalide.');
    }

    let row = getFeedRowBySlug(slug);
    if (!row) return reply.code(404).type('text/plain; charset=utf-8').send('Flux introuvable.');
    if (!row.last_fetch_at) {
      await Promise.race([refreshFeed(row.id, 'request').catch(() => undefined), sleep(30_000)]);
      row = getFeedRowBySlug(slug) ?? row;
    }

    const options = parseOptions(row);
    const items = outputItems(row.id, options.maxItems);
    const keyQuery = settings.feedKeyRequired ? `?key=${encodeURIComponent(settings.feedKey)}` : '';
    const feed: OutputFeed = {
      slug,
      title: row.name,
      description: row.description,
      siteUrl: row.site_url,
      iconUrl: row.icon_url,
      selfUrl: `${baseUrl(req)}/f/${encodeURIComponent(slug)}.${ext}${keyQuery}`,
      refreshMinutes: options.refreshMinutes,
      updatedAt: Math.max(row.last_success_at ?? 0, row.updated_at),
    };

    const etag = `"${sha1(`${ext}|${feed.updatedAt}|${items.length}|${items[0]?.guid ?? ''}|${row.name}`).slice(0, 24)}"`;
    reply
      .header('etag', etag)
      .header('last-modified', new Date(feed.updatedAt).toUTCString())
      .header('cache-control', 'private, max-age=60');
    if (req.headers['if-none-match'] === etag) return reply.code(304).send();

    const body = ext === 'atom' ? renderAtom(feed, items) : ext === 'json' ? renderJsonFeed(feed, items) : renderRss(feed, items);
    const fromBrowser = /text\/html/.test(req.headers.accept ?? '');
    const type = fromBrowser ? (ext === 'json' ? 'application/json; charset=utf-8' : 'text/xml; charset=utf-8') : TYPES[ext];
    return reply.type(type).send(body);
  });
}
