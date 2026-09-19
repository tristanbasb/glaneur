// Serializes stored items as RSS 2.0, Atom 1.0, JSON Feed 1.1 and OPML.
import { escapeHtml } from './core/html.js';
import { sha1 } from './util.js';

export interface OutputFeed {
  slug: string;
  title: string;
  description: string;
  siteUrl: string;
  iconUrl: string;
  selfUrl: string;
  refreshMinutes: number;
  updatedAt: number;
}

export interface OutputItem {
  guid: string;
  title: string;
  link: string | null;
  content: string | null;
  summary: string | null;
  image: string | null;
  author: string | null;
  date: number;
}

function isXmlChar(code: number): boolean {
  return (
    code === 0x9 ||
    code === 0xa ||
    code === 0xd ||
    (code >= 0x20 && code <= 0xd7ff) ||
    (code >= 0xe000 && code <= 0xfffd) ||
    (code >= 0x10000 && code <= 0x10ffff)
  );
}

/** Removes characters that are not allowed in XML 1.0 documents. */
function stripInvalidXml(value: string): string {
  let clean = true;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x20 ? code !== 0x9 && code !== 0xa && code !== 0xd : code >= 0xd800) {
      clean = false;
      break;
    }
  }
  if (clean) return value;
  let out = '';
  for (const ch of value) if (isXmlChar(ch.codePointAt(0)!)) out += ch;
  return out;
}

function x(value: string): string {
  return stripInvalidXml(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function cdata(value: string): string {
  return `<![CDATA[${stripInvalidXml(value).replace(/\]\]>/g, ']]]]><![CDATA[>')}]]>`;
}

function imageType(url: string): string {
  const ext = /\.(jpe?g|png|gif|webp|avif|svg)(\?|#|$)/i.exec(url)?.[1]?.toLowerCase();
  if (!ext || ext === 'jpg') return 'image/jpeg';
  if (ext === 'svg') return 'image/svg+xml';
  return `image/${ext}`;
}

/** Content with the item image first, unless the content already shows an image. */
function richContent(item: OutputItem): string {
  let html = item.content ?? (item.summary ? `<p>${escapeHtml(item.summary)}</p>` : '');
  if (item.image && !/<img\s/i.test(html)) html = `<p><img src="${escapeHtml(item.image)}" alt=""></p>${html}`;
  return html;
}

function atomId(guid: string): string {
  return /^(https?:|urn:|tag:)/i.test(guid) ? guid : `urn:glaneur:${sha1(guid)}`;
}

function defaultDescription(feed: OutputFeed): string {
  return feed.description || `Flux créé avec Glaneur pour ${feed.title}`;
}

export function renderRss(feed: OutputFeed, items: OutputItem[]): string {
  const home = feed.siteUrl || feed.selfUrl;
  const out = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:media="http://search.yahoo.com/mrss/">',
    '<channel>',
    `<title>${x(feed.title)}</title>`,
    `<link>${x(home)}</link>`,
    `<description>${x(defaultDescription(feed))}</description>`,
    `<atom:link href="${x(feed.selfUrl)}" rel="self" type="application/rss+xml"/>`,
    '<generator>Glaneur</generator>',
    `<lastBuildDate>${new Date(feed.updatedAt).toUTCString()}</lastBuildDate>`,
    `<ttl>${feed.refreshMinutes}</ttl>`,
  ];
  if (feed.iconUrl) out.push(`<image><url>${x(feed.iconUrl)}</url><title>${x(feed.title)}</title><link>${x(home)}</link></image>`);
  for (const item of items) {
    out.push('<item>', `<title>${x(item.title)}</title>`);
    if (item.link) out.push(`<link>${x(item.link)}</link>`);
    out.push(`<guid isPermaLink="${/^https?:\/\//i.test(item.guid)}">${x(item.guid)}</guid>`);
    out.push(`<pubDate>${new Date(item.date).toUTCString()}</pubDate>`);
    if (item.author) out.push(`<dc:creator>${x(item.author)}</dc:creator>`);
    if (item.summary) out.push(`<description>${x(item.summary)}</description>`);
    const html = richContent(item);
    if (html) out.push(`<content:encoded>${cdata(html)}</content:encoded>`);
    if (item.image) {
      out.push(`<media:content url="${x(item.image)}" medium="image"/>`);
      out.push(`<enclosure url="${x(item.image)}" length="0" type="${imageType(item.image)}"/>`);
    }
    out.push('</item>');
  }
  out.push('</channel>', '</rss>');
  return out.join('\n');
}

export function renderAtom(feed: OutputFeed, items: OutputItem[]): string {
  const out = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<feed xmlns="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/">',
    `<title type="text">${x(feed.title)}</title>`,
    `<subtitle type="text">${x(defaultDescription(feed))}</subtitle>`,
    `<link href="${x(feed.selfUrl)}" rel="self" type="application/atom+xml"/>`,
  ];
  if (feed.siteUrl) out.push(`<link href="${x(feed.siteUrl)}" rel="alternate" type="text/html"/>`);
  out.push(`<id>${x(feed.selfUrl)}</id>`, `<updated>${new Date(feed.updatedAt).toISOString()}</updated>`, '<generator>Glaneur</generator>');
  if (feed.iconUrl) out.push(`<icon>${x(feed.iconUrl)}</icon>`);
  for (const item of items) {
    const date = new Date(item.date).toISOString();
    out.push('<entry>', `<title type="text">${x(item.title)}</title>`);
    if (item.link) out.push(`<link href="${x(item.link)}" rel="alternate" type="text/html"/>`);
    out.push(`<id>${x(atomId(item.guid))}</id>`, `<published>${date}</published>`, `<updated>${date}</updated>`);
    if (item.author) out.push(`<author><name>${x(item.author)}</name></author>`);
    if (item.summary) out.push(`<summary type="text">${x(item.summary)}</summary>`);
    const html = richContent(item);
    if (html) out.push(`<content type="html">${x(html)}</content>`);
    if (item.image) out.push(`<media:thumbnail url="${x(item.image)}"/>`);
    out.push('</entry>');
  }
  out.push('</feed>');
  return out.join('\n');
}

export function renderJsonFeed(feed: OutputFeed, items: OutputItem[]): string {
  return JSON.stringify(
    {
      version: 'https://jsonfeed.org/version/1.1',
      title: feed.title,
      home_page_url: feed.siteUrl || undefined,
      feed_url: feed.selfUrl,
      description: feed.description || undefined,
      icon: feed.iconUrl || undefined,
      favicon: feed.iconUrl || undefined,
      items: items.map((item) => ({
        id: item.guid,
        url: item.link ?? undefined,
        title: item.title,
        content_html: richContent(item) || undefined,
        summary: item.summary ?? undefined,
        image: item.image ?? undefined,
        date_published: new Date(item.date).toISOString(),
        authors: item.author ? [{ name: item.author }] : undefined,
      })),
    },
    null,
    2,
  );
}

export function renderOpml(title: string, feeds: Array<{ name: string; xmlUrl: string; htmlUrl: string }>): string {
  const out = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<opml version="2.0">',
    `<head><title>${x(title)}</title><dateCreated>${new Date().toUTCString()}</dateCreated></head>`,
    '<body>',
  ];
  for (const f of feeds) {
    out.push(`<outline type="rss" text="${x(f.name)}" title="${x(f.name)}" xmlUrl="${x(f.xmlUrl)}"${f.htmlUrl ? ` htmlUrl="${x(f.htmlUrl)}"` : ''}/>`);
  }
  out.push('</body>', '</opml>');
  return out.join('\n');
}
