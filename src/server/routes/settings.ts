import type { FastifyInstance } from 'fastify';
import type { AppSettings, SystemInfo } from '../../shared/types.js';
import { config } from '../config.js';
import { browserPath } from '../core/browser.js';
import { all, dbSize } from '../db.js';
import { countStats, createFeed, type FeedRow, listFeeds, parseOptions, parseSource, validateFeedInput } from '../feeds.js';
import { renderOpml } from '../output.js';
import { baseUrl } from '../request.js';
import { getSettings, rotateFeedKey, updateSettings } from '../settings.js';
import { errorMessage } from '../util.js';

export async function settingsRoutes(app: FastifyInstance) {
  app.get('/api/settings', async () => getSettings());

  app.put('/api/settings', async (req) => updateSettings((req.body ?? {}) as Partial<AppSettings>));

  app.post('/api/settings/rotate-key', async () => ({ feedKey: rotateFeedKey() }));

  app.get('/api/system', async (): Promise<SystemInfo> => {
    const stats = countStats();
    const path = browserPath();
    return {
      version: config.version,
      node: process.version,
      authMode: config.authMode,
      browser: { available: !!path, path },
      dataDir: config.dataDir,
      dbSizeBytes: dbSize(),
      uptimeSec: Math.round(process.uptime()),
      feeds: stats.feeds,
      items: stats.items,
    };
  });

  app.get('/api/export', async (_req, reply) => {
    const rows = all<FeedRow>('SELECT * FROM feeds ORDER BY created_at');
    const data = {
      app: 'glaneur',
      version: 1,
      exportedAt: new Date().toISOString(),
      feeds: rows.map((r) => ({
        name: r.name,
        slug: r.slug,
        description: r.description,
        siteUrl: r.site_url,
        iconUrl: r.icon_url,
        enabled: !!r.enabled,
        recipe: r.recipe,
        source: parseSource(r),
        options: parseOptions(r),
      })),
    };
    return reply
      .header('content-disposition', `attachment; filename="glaneur-${new Date().toISOString().slice(0, 10)}.json"`)
      .type('application/json; charset=utf-8')
      .send(JSON.stringify(data, null, 2));
  });

  app.post('/api/import', async (req, reply) => {
    const body = (req.body ?? {}) as { feeds?: unknown };
    if (!Array.isArray(body.feeds)) return reply.code(400).send({ error: 'Ce fichier n’est pas un export Glaneur.' });
    let imported = 0;
    const errors: string[] = [];
    body.feeds.forEach((raw, i) => {
      try {
        createFeed(validateFeedInput(raw));
        imported++;
      } catch (err) {
        errors.push(`Flux n°${i + 1} : ${errorMessage(err)}`);
      }
    });
    return { imported, errors };
  });

  app.get('/api/opml', async (req, reply) => {
    const feeds = listFeeds(baseUrl(req)).map((f) => ({ name: f.name, xmlUrl: f.urls.rss, htmlUrl: f.siteUrl }));
    return reply
      .header('content-disposition', 'attachment; filename="glaneur.opml"')
      .type('text/x-opml; charset=utf-8')
      .send(renderOpml('Glaneur', feeds));
  });
}
