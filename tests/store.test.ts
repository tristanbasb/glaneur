import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ItemData } from '../src/shared/types.js';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'glaneur-test-'));
const feeds = await import('../src/server/feeds.js');

function item(guid: string, date: number | null): ItemData {
  return { guid, title: guid, link: `https://exemple.fr/${guid}`, content: null, summary: null, image: null, author: null, date };
}

function newFeed(): string {
  return feeds.createFeed({ name: `Test ${Math.random()}`, enabled: true, source: { type: 'feed', urls: ['https://exemple.fr/feed'] }, options: feeds.defaultOptions() });
}

describe('storeItems', () => {
  const at = Date.parse('2026-09-15T12:00:00Z');

  it('keeps page order for undated items placed between dated ones', () => {
    const id = newFeed();
    feeds.storeItems(id, [item('a', at - 3_600_000), item('promo', null), item('b', at - 7_200_000)], at, 50);
    expect(feeds.listItems(id, 10).map((i) => i.guid)).toEqual(['a', 'promo', 'b']);
  });

  it('keeps page order when no item has a date', () => {
    const id = newFeed();
    feeds.storeItems(id, [item('first', null), item('second', null), item('third', null)], at, 50);
    expect(feeds.listItems(id, 10).map((i) => i.guid)).toEqual(['first', 'second', 'third']);
  });

  it('adds only new items on later refreshes and puts them first', () => {
    const id = newFeed();
    expect(feeds.storeItems(id, [item('one', null), item('two', null)], at, 50).added).toBe(2);
    const later = at + 3_600_000;
    expect(feeds.storeItems(id, [item('zero', null), item('one', null), item('two', null)], later, 50).added).toBe(1);
    expect(feeds.listItems(id, 10).map((i) => i.guid)).toEqual(['zero', 'one', 'two']);
  });

  it('prunes items that left the page beyond the retention window', () => {
    const id = newFeed();
    const batch = Array.from({ length: 120 }, (_, i) => item(`old-${i}`, null));
    feeds.storeItems(id, batch, at, 10);
    feeds.storeItems(id, [item('fresh', null)], at + 60_000, 10);
    const kept = feeds.listItems(id, 500);
    expect(kept.length).toBe(100);
    expect(kept[0].guid).toBe('fresh');
  });
});
