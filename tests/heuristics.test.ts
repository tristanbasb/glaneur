import { describe, expect, it } from 'vitest';
import { detectJsonLists, extractJsonItems, readJsonField } from '../src/server/core/extract-json.js';
import { applyFilters, normalizeItems } from '../src/server/core/normalize.js';
import { cssEscape, isUsableClass, moduleClassPrefix } from '../src/shared/css.js';

describe('class heuristics', () => {
  it.each([
    ['post-card', true],
    ['entry-title', true],
    ['tgme_widget_message_text', true],
    ['css-1q2w3e', false],
    ['sc-bdVaJa', false],
    ['md:flex', false],
    ['post-123', false],
    ['active', false],
    ['text-sm', false],
    ['mt-4', false],
    ['kQmZzL', false],
    ['a3f9c2', false],
  ])('%s → %s', (name, expected) => {
    expect(isUsableClass(name)).toBe(expected);
  });

  it('turns CSS-module classes into stable prefixes', () => {
    expect(moduleClassPrefix('Card_title__x9Kd2')).toBe('Card_title__');
    expect(moduleClassPrefix('card__title')).toBeNull();
  });

  it('escapes identifiers', () => {
    expect(cssEscape('1col')).toBe('\\31 col');
    expect(cssEscape('a.b')).toBe('a\\.b');
  });
});

const reddit = {
  kind: 'Listing',
  data: {
    after: 't3_x',
    children: Array.from({ length: 5 }, (_, i) => ({
      kind: 't3',
      data: {
        title: `Post ${i}`,
        permalink: `/r/selfhosted/comments/${i}/post/`,
        url: `https://example.com/${i}`,
        created_utc: 1789000000 + i,
        author: `user${i}`,
        selftext: 'Un texte assez long pour être une description valable.',
      },
    })),
  },
};

describe('JSON sources', () => {
  it('finds the list and guesses fields', () => {
    const [best] = detectJsonLists(reddit);
    expect(best.itemsPath).toBe('data.children');
    expect(best.fields.title).toBe('data.title');
    expect(best.fields.date).toBe('data.created_utc');
  });

  it('prefers page links over API links, and names over profile URLs', () => {
    const releases = [1, 2, 3].map((i) => ({
      url: `https://api.github.com/repos/o/r/releases/${i}`,
      html_url: `https://github.com/o/r/releases/tag/v${i}`,
      id: i,
      author: { login: 'octocat', id: 1, url: 'https://api.github.com/users/octocat', html_url: 'https://github.com/octocat' },
      name: `v${i}.0`,
      created_at: '2026-09-10T10:00:00Z',
      published_at: '2026-09-11T10:00:00Z',
      body: 'Notes de version suffisamment longues pour une description.',
    }));
    const [best] = detectJsonLists(releases);
    expect(best.itemsPath).toBe('');
    expect(best.fields).toMatchObject({ title: 'name', link: 'html_url', date: 'published_at', author: 'author.login', description: 'body' });
  });

  it('fills templates', () => {
    expect(readJsonField({ slug: 'abc', id: 3 }, 'https://site.fr/{{slug}}-{{id}}')).toBe('https://site.fr/abc-3');
  });

  it('extracts items with templates and timestamps', () => {
    const items = extractJsonItems(reddit, { itemsPath: 'data.children', fields: { title: 'data.title', link: 'https://www.reddit.com{{data.permalink}}', date: 'data.created_utc' } }, null);
    expect(items[0].link).toBe('https://www.reddit.com/r/selfhosted/comments/0/post/');
    expect(items[0].date).toBe(1789000000 * 1000);
  });
});

describe('filters', () => {
  const items = normalizeItems(
    [
      { title: 'Nouvelle version de Proxmox', link: 'https://a.fr/1', content: 'Mise à jour', contentIsHtml: false, date: null, image: null, author: null, found: {} },
      { title: 'Promo sur les disques', link: 'https://a.fr/shorts/2', content: 'Pub', contentIsHtml: false, date: null, image: null, author: null, found: {} },
      { title: 'Élection du délégué', link: 'https://a.fr/3', content: 'Vie locale', contentIsHtml: false, date: null, image: null, author: null, found: {} },
    ],
    'https://a.fr/',
  );

  it('excludes, ignoring accents and case', () => {
    const kept = applyFilters(items, [{ mode: 'exclude', field: 'title', pattern: 'election' }]);
    expect(kept.map((i) => i.link)).toEqual(['https://a.fr/1', 'https://a.fr/shorts/2']);
  });

  it('keeps only matches when include rules exist, with regex support', () => {
    const kept = applyFilters(items, [
      { mode: 'include', field: 'any', pattern: 'proxmox|disques', regex: true },
      { mode: 'exclude', field: 'link', pattern: '/shorts/' },
    ]);
    expect(kept.map((i) => i.link)).toEqual(['https://a.fr/1']);
  });
});
