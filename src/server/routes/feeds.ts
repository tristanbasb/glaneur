import type { FastifyInstance } from 'fastify';
import type { ClickResult, PreviewResult } from '../../shared/types.js';
import { analyzeUrl } from '../analyze.js';
import { clickThrough } from '../core/browser.js';
import { jsonFromHtml, parseJsonBody } from '../core/extract-json.js';
import { escapeHtml } from '../core/html.js';
import { normalizeUrl } from '../core/http.js';
import { isFeedContent, isJsonContent, loadPage } from '../core/pages.js';
import { refreshFeed } from '../core/runner.js';
import { runSource } from '../core/source.js';
import {
  clearItems,
  createFeed,
  deleteFeed,
  getFeedDetail,
  getFeedRow,
  listFeeds,
  listItems,
  renderOptions,
  setFeedEnabled,
  updateFeed,
  validateFeedInput,
  validateOptions,
  validateSource,
} from '../feeds.js';
import { buildRecipe, recipeInfos } from '../recipes.js';
import { baseUrl } from '../request.js';
import { errorMessage } from '../util.js';
import { prepareViewHtml, VIEW_CSP } from '../view.js';

type IdParams = { Params: { id: string } };

const NOT_FOUND = { error: 'Flux introuvable.' };

function messagePage(title: string, message: string): string {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#f3f4ef;color:#1b1e24;font:15px/1.5 system-ui,sans-serif">
<div style="max-width:440px;padding:32px;text-align:center"><p style="font-weight:700;font-size:18px;margin:0 0 8px">${escapeHtml(title)}</p>
<p style="margin:0;color:#5b606b">${escapeHtml(message)}</p></div></body></html>`;
}

function trimJson(value: unknown, depth: number): unknown {
  if (depth > 14) return '…';
  if (typeof value === 'string') return value.length > 300 ? `${value.slice(0, 300)}…` : value;
  if (Array.isArray(value)) return value.slice(0, 40).map((v) => trimJson(v, depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).slice(0, 80).map(([k, v]) => [k, trimJson(v, depth + 1)]));
  }
  return value;
}

function parseJsonParam(value: string | undefined): unknown {
  if (!value) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

export async function feedRoutes(app: FastifyInstance) {
  app.get('/api/feeds', async (req) => listFeeds(baseUrl(req)));

  app.get<IdParams>('/api/feeds/:id', async (req, reply) => getFeedDetail(req.params.id, baseUrl(req)) ?? reply.code(404).send(NOT_FOUND));

  app.post('/api/feeds', async (req, reply) => {
    const id = createFeed(validateFeedInput(req.body));
    void refreshFeed(id, 'create');
    return reply.code(201).send(getFeedDetail(id, baseUrl(req)));
  });

  app.put<IdParams>('/api/feeds/:id', async (req, reply) => {
    const input = validateFeedInput(req.body);
    const before = getFeedRow(req.params.id);
    if (!before || !updateFeed(req.params.id, input)) return reply.code(404).send(NOT_FOUND);
    const after = getFeedRow(req.params.id)!;
    if (after.enabled && (after.source !== before.source || after.options !== before.options)) void refreshFeed(req.params.id, 'edit');
    return getFeedDetail(req.params.id, baseUrl(req));
  });

  app.delete<IdParams>('/api/feeds/:id', async (req, reply) => (deleteFeed(req.params.id) ? { ok: true } : reply.code(404).send(NOT_FOUND)));

  app.post<IdParams>('/api/feeds/:id/refresh', async (req, reply) => {
    if (!getFeedRow(req.params.id)) return reply.code(404).send(NOT_FOUND);
    const result = await refreshFeed(req.params.id, 'manual');
    return { result, feed: getFeedDetail(req.params.id, baseUrl(req)) };
  });

  app.post<IdParams>('/api/feeds/:id/enabled', async (req, reply) => {
    const enabled = (req.body as { enabled?: unknown } | undefined)?.enabled === true;
    if (!setFeedEnabled(req.params.id, enabled)) return reply.code(404).send(NOT_FOUND);
    return getFeedDetail(req.params.id, baseUrl(req));
  });

  app.post<IdParams>('/api/feeds/:id/clear', async (req, reply) => {
    if (!getFeedRow(req.params.id)) return reply.code(404).send(NOT_FOUND);
    clearItems(req.params.id);
    void refreshFeed(req.params.id, 'manual');
    return { ok: true };
  });

  app.get<IdParams & { Querystring: { limit?: string } }>('/api/feeds/:id/items', async (req, reply) => {
    if (!getFeedRow(req.params.id)) return reply.code(404).send(NOT_FOUND);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit ?? '50', 10) || 50));
    return listItems(req.params.id, limit);
  });

  app.post('/api/preview', async (req, reply) => {
    const body = (req.body ?? {}) as { source?: unknown; options?: unknown; fresh?: unknown };
    const source = validateSource(body.source);
    const options = validateOptions(body.options);
    const started = Date.now();
    try {
      const r = await runSource(source, options, { mode: 'preview', useCache: body.fresh !== true });
      const result: PreviewResult = {
        items: r.items.slice(0, 60),
        found: r.found,
        kept: r.items.length,
        warnings: r.warnings,
        pageTitle: r.pageTitle,
        finalUrl: r.finalUrl,
        durationMs: Date.now() - started,
        rendered: r.rendered,
      };
      return result;
    } catch (err) {
      return reply.code(422).send({ error: errorMessage(err) });
    }
  });

  app.post('/api/analyze', async (req, reply) => {
    const body = (req.body ?? {}) as { url?: unknown; render?: unknown };
    if (typeof body.url !== 'string' || !body.url.trim()) return reply.code(400).send({ error: 'Collez l’adresse d’une page.' });
    try {
      return await analyzeUrl(body.url, { render: body.render === true });
    } catch (err) {
      return reply.code(422).send({ error: errorMessage(err) });
    }
  });

  // The page shown inside the visual selector (sandboxed iframe, same origin, no scripts).
  // Clicks a button of the page in Chromium (a consent banner's, say) and hands back the cookies it earned.
  app.post('/api/click', async (req, reply) => {
    const body = (req.body ?? {}) as { url?: unknown; request?: unknown; selector?: unknown; text?: unknown };
    const selector = typeof body.selector === 'string' ? body.selector.trim().slice(0, 1000) : '';
    const text = typeof body.text === 'string' ? body.text.trim().slice(0, 200) : '';
    const { request } = validateOptions({ request: body.request });
    try {
      const url = normalizeUrl(String(body.url ?? ''));
      if (!selector && !text) throw new Error('Désignez le bouton à cliquer dans la page.');
      const result: ClickResult = await clickThrough(url, request, { selector, text });
      return result;
    } catch (err) {
      return reply.code(422).send({ error: errorMessage(err) });
    }
  });

  app.get<{ Querystring: { url?: string; render?: string; request?: string; fresh?: string } }>('/api/view', async (req, reply) => {
    // Only the editor may embed fetched pages: refuse navigations coming from other sites.
    const site = req.headers['sec-fetch-site'];
    if (site && site !== 'same-origin') return reply.code(403).type('text/plain; charset=utf-8').send('Accès refusé.');
    reply
      .header('content-security-policy', VIEW_CSP)
      .header('referrer-policy', 'no-referrer')
      .header('x-content-type-options', 'nosniff')
      .type('text/html; charset=utf-8');
    let url: string;
    try {
      url = normalizeUrl(req.query.url ?? '');
    } catch (err) {
      return reply.send(messagePage('Adresse invalide', errorMessage(err)));
    }
    try {
      const render = renderOptions(parseJsonParam(req.query.render));
      const { request } = validateOptions({ request: parseJsonParam(req.query.request) });
      const page = await loadPage(url, { render, request, useCache: req.query.fresh !== '1' });
      if (!page.rendered && (isFeedContent(page) || isJsonContent(page))) {
        return reply.send(messagePage('Ce n’est pas une page web', 'Cette adresse renvoie un flux ou du JSON : utilisez plutôt « Flux existant » ou « API JSON ».'));
      }
      return reply.send(prepareViewHtml(page.body, page.finalUrl));
    } catch (err) {
      return reply.send(messagePage('Impossible d’afficher la page', errorMessage(err)));
    }
  });

  // Raw JSON (trimmed) for the JSON explorer of the editor.
  app.post('/api/json-sample', async (req, reply) => {
    const body = (req.body ?? {}) as { source?: unknown; options?: unknown };
    const source = validateSource(body.source);
    if (source.type !== 'json') return reply.code(400).send({ error: 'Source JSON attendue.' });
    const { request } = validateOptions(body.options);
    try {
      let root: unknown;
      if (source.embedSelector) {
        root = jsonFromHtml((await loadPage(source.url, { request, useCache: true })).body, source.embedSelector);
      } else {
        const page = await loadPage(source.url, {
          request,
          method: source.method,
          body: source.body,
          accept: 'application/json,text/plain;q=0.9,*/*;q=0.5',
          useCache: true,
        });
        root = parseJsonBody(page.body);
      }
      return { data: trimJson(root, 0) };
    } catch (err) {
      return reply.code(422).send({ error: errorMessage(err) });
    }
  });

  app.get('/api/recipes', async () => recipeInfos());

  app.post<IdParams>('/api/recipes/:id/build', async (req) => {
    const body = (req.body ?? {}) as { params?: unknown };
    return { input: await buildRecipe(req.params.id, body.params) };
  });
}
