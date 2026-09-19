// Fetches the linked article and keeps its main content (Readability or a CSS selector).
import { Readability } from '@mozilla/readability';
import * as cheerio from 'cheerio';
import { parseHTML } from 'linkedom';
import type { RequestOptions } from '../../shared/types.js';
import { fetchText } from './http.js';
import { sanitizeContent } from './html.js';

export async function fetchFullText(url: string, opts: { selector?: string; request?: RequestOptions }): Promise<string | null> {
  const page = await fetchText(url, { request: opts.request, timeoutMs: 20_000 });
  if (!/html/i.test(page.contentType) && !page.body.trimStart().startsWith('<')) return null;

  const selector = opts.selector?.trim();
  if (selector) {
    const $ = cheerio.load(page.body);
    let parts: string[];
    try {
      parts = $(selector)
        .toArray()
        .map((el) => $(el).html() ?? '')
        .filter((h) => h.trim());
    } catch {
      throw new Error(`Sélecteur de contenu invalide : ${selector}`);
    }
    return parts.length ? sanitizeContent(parts.join('\n'), page.finalUrl) || null : null;
  }

  const { document } = parseHTML(page.body);
  const article = new Readability(document as never, { charThreshold: 250 }).parse();
  if (!article?.content) return null;
  return sanitizeContent(article.content, page.finalUrl) || null;
}
