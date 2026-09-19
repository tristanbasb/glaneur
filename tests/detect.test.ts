import * as cheerio from 'cheerio';
import { describe, expect, it } from 'vitest';
import { cheerioAdapter } from '../src/server/core/dom.js';
import { extractHtmlItems } from '../src/server/core/extract-html.js';
import { normalizeItems } from '../src/server/core/normalize.js';
import { detectLists } from '../src/shared/detect.js';

const titles = ['Premier article sur Proxmox', 'Sauvegarder ses conteneurs LXC', 'Un reverse proxy avec Caddy', 'Surveiller ses services', 'Mettre à jour Debian 13'];

function blogPage(): string {
  const cards = titles
    .map(
      (t, i) => `
    <article class="post-card post-${100 + i}">
      <a class="post-card__media" href="/articles/${i + 1}-illustration"><img src="/img/${i + 1}.jpg" alt=""></a>
      <div class="post-card__body">
        <h2 class="post-card__title"><a href="/articles/${i + 1}">${t}</a></h2>
        <p class="post-card__excerpt">Résumé de l'article numéro ${i + 1}, assez long pour ressembler à un vrai chapô de blog.</p>
        <time datetime="2026-09-${String(10 - i).padStart(2, '0')}T08:00:00+02:00">${10 - i} septembre 2026</time>
      </div>
    </article>`,
    )
    .join('');
  return `<!doctype html><html lang="fr"><head><title>Blog</title></head><body>
    <header class="site-header"><nav><ul><li><a href="/">Accueil</a></li><li><a href="/blog">Blog</a></li><li><a href="/a-propos">À propos</a></li><li><a href="/contact">Contact</a></li></ul></nav></header>
    <main><h1>Derniers articles</h1><div class="post-list">${cards}</div></main>
    <footer><ul class="footer-links"><li><a href="/mentions">Mentions légales</a></li><li><a href="/rss">Flux</a></li><li><a href="/plan">Plan du site</a></li></ul></footer>
  </body></html>`;
}

describe('detectLists', () => {
  it('finds the article cards and guesses every field', () => {
    const $ = cheerio.load(blogPage());
    const lists = detectLists(cheerioAdapter($), $('body').get(0)!, 5);
    expect(lists.length).toBeGreaterThan(0);
    const best = lists[0];
    expect($(best.selector).length).toBe(5);

    const raw = extractHtmlItems($, { itemSelector: best.selector, fields: best.fields }, 'fr');
    const items = normalizeItems(raw, 'https://blog.exemple.fr/');
    expect(items.map((i) => i.title)).toEqual(titles);
    expect(items[0].link).toBe('https://blog.exemple.fr/articles/1');
    expect(items[0].image).toBe('https://blog.exemple.fr/img/1.jpg');
    expect(items[0].date).toBe(Date.parse('2026-09-10T08:00:00+02:00'));
    expect(items[0].summary).toContain('Résumé');
  });

  it('picks story rows over helper rows in table layouts', () => {
    const rows = Array.from(
      { length: 6 },
      (_, i) => `
      <tr class="athing" id="${4000 + i}"><td class="title"><span class="titleline"><a href="https://example${i}.com/story">Story number ${i + 1} with a fairly long title</a></span></td></tr>
      <tr><td class="subtext"><span class="score">${10 + i} points</span> <a href="item?id=${4000 + i}">${i} comments</a></td></tr>
      <tr class="spacer"></tr>`,
    ).join('');
    const $ = cheerio.load(`<html><body><table id="hnmain"><tr><td><table>${rows}</table></td></tr></table></body></html>`);
    const [best] = detectLists(cheerioAdapter($), $('body').get(0)!, 5);
    expect($(best.selector).length).toBe(6);
    expect($(best.selector).first().hasClass('athing')).toBe(true);
    const items = normalizeItems(extractHtmlItems($, { itemSelector: best.selector, fields: best.fields }, 'en'), 'https://news.example.com/');
    expect(items[0].link).toBe('https://example0.com/story');
  });

  it('takes the link carrying the title when no link rule is set', () => {
    const rows = Array.from(
      { length: 3 },
      (_, i) => `<tr class="athing"><td class="votelinks"><a href="vote?id=${i}&how=up">up</a></td><td class="title"><span class="titleline"><a href="https://example${i}.com/story">Story ${i}</a></span></td></tr>`,
    ).join('');
    const $ = cheerio.load(`<html><body><table>${rows}</table></body></html>`);
    const raw = extractHtmlItems($, { itemSelector: 'tr.athing', fields: { title: { selector: 'span.titleline > a', attr: 'text' } } }, 'en');
    const items = normalizeItems(raw, 'https://news.example.com/');
    expect(items.map((i) => i.link)).toEqual(['https://example0.com/story', 'https://example1.com/story', 'https://example2.com/story']);
  });
});
