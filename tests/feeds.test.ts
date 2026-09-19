import { XMLValidator } from 'fast-xml-parser';
import { describe, expect, it } from 'vitest';
import { parseFeed } from '../src/server/core/feedparse.js';
import { type OutputFeed, type OutputItem, renderAtom, renderJsonFeed, renderRss } from '../src/server/output.js';

const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/">
<channel><title>Le Blog</title><link>https://blog.exemple.fr/</link><description>Desc</description>
<item><title>Article &amp; test</title><link>https://blog.exemple.fr/a</link><guid isPermaLink="false">id-1</guid>
<pubDate>Tue, 15 Sep 2026 08:00:00 +0200</pubDate><dc:creator>Alice</dc:creator>
<description>Résumé</description><content:encoded><![CDATA[<p>Contenu <b>riche</b></p>]]></content:encoded>
<enclosure url="https://blog.exemple.fr/i.jpg" type="image/jpeg" length="0"/></item>
</channel></rss>`;

const atom = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/">
<title>Chaîne</title><link rel="alternate" href="https://www.youtube.com/channel/UC1"/>
<entry><id>yt:video:abc</id><title>Vidéo</title><link rel="alternate" href="https://www.youtube.com/watch?v=abc"/>
<author><name>Chaîne</name></author><published>2026-09-10T12:56:17+00:00</published>
<media:group><media:thumbnail url="https://i2.ytimg.com/vi/abc/hqdefault.jpg" width="480" height="360"/>
<media:description>Une description
sur deux lignes</media:description></media:group></entry></feed>`;

describe('parseFeed', () => {
  it('reads RSS 2.0', () => {
    const feed = parseFeed(rss, 'https://blog.exemple.fr/feed');
    expect(feed.title).toBe('Le Blog');
    const item = feed.items[0];
    expect(item.title).toBe('Article & test');
    expect(item.guid).toBe('id-1');
    expect(item.content).toContain('<b>riche</b>');
    expect(item.contentIsHtml).toBe(true);
    expect(item.author).toBe('Alice');
    expect(item.image).toBe('https://blog.exemple.fr/i.jpg');
    expect(item.date).toBe(Date.parse('2026-09-15T06:00:00Z'));
  });

  it('reads Atom with media groups (YouTube)', () => {
    const feed = parseFeed(atom, 'https://www.youtube.com/feeds/videos.xml');
    const entry = feed.items[0];
    expect(feed.format).toBe('atom');
    expect(entry.link).toBe('https://www.youtube.com/watch?v=abc');
    expect(entry.image).toBe('https://i2.ytimg.com/vi/abc/hqdefault.jpg');
    expect(entry.content).toContain('deux lignes');
    expect(entry.contentIsHtml).toBe(false);
  });

  it('reads JSON Feed', () => {
    const body = JSON.stringify({
      version: 'https://jsonfeed.org/version/1.1',
      title: 'J',
      items: [{ id: '1', url: 'https://x.fr/1', title: 'Un', content_html: '<p>Hi</p>', date_published: '2026-09-01T10:00:00Z' }],
    });
    const feed = parseFeed(body, 'https://x.fr/feed.json');
    expect(feed.items[0].title).toBe('Un');
    expect(feed.items[0].contentIsHtml).toBe(true);
  });
});

const outFeed: OutputFeed = {
  slug: 'test',
  title: 'Titre <spécial> & "guillemets"',
  description: '',
  siteUrl: 'https://exemple.fr',
  iconUrl: '',
  selfUrl: 'http://localhost:8080/f/test.rss?key=abc&x=1',
  refreshMinutes: 60,
  updatedAt: Date.parse('2026-09-15T10:00:00Z'),
};

const outItems: OutputItem[] = [
  {
    guid: 'https://exemple.fr/a',
    title: 'Un ]]> piège',
    link: 'https://exemple.fr/a?b=1&c=2',
    content: `<p>Contenu ]]> avec CDATA</p>${String.fromCharCode(1)}`,
    summary: 'Résumé',
    image: 'https://exemple.fr/i.png',
    author: 'Bob',
    date: Date.parse('2026-09-14T10:00:00Z'),
  },
];

describe('feed output', () => {
  it('writes valid RSS that reads back', () => {
    const xml = renderRss(outFeed, outItems);
    expect(XMLValidator.validate(xml)).toBe(true);
    const parsed = parseFeed(xml, outFeed.selfUrl);
    expect(parsed.title).toBe(outFeed.title);
    expect(parsed.items[0].title).toBe('Un ]]> piège');
    expect(parsed.items[0].link).toBe('https://exemple.fr/a?b=1&c=2');
    expect(parsed.items[0].content).toContain('avec CDATA');
    expect(parsed.items[0].image).toBe('https://exemple.fr/i.png');
  });

  it('writes valid Atom', () => {
    const xml = renderAtom(outFeed, outItems);
    expect(XMLValidator.validate(xml)).toBe(true);
    expect(parseFeed(xml, outFeed.selfUrl).items[0].link).toBe('https://exemple.fr/a?b=1&c=2');
  });

  it('writes JSON Feed 1.1', () => {
    const json = JSON.parse(renderJsonFeed(outFeed, outItems));
    expect(json.version).toBe('https://jsonfeed.org/version/1.1');
    expect(json.items[0].url).toBe('https://exemple.fr/a?b=1&c=2');
  });
});
