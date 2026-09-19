// Parses RSS 2.0, RSS 1.0 (RDF), Atom and JSON Feed documents.
import { XMLBuilder, XMLParser } from 'fast-xml-parser';
import { parseDate } from './dates.js';
import type { RawItem } from './extract-html.js';
import { absolutize, looksLikeHtml } from './html.js';

export interface ParsedFeed {
  format: 'rss' | 'atom' | 'json';
  title: string | null;
  link: string | null;
  description: string | null;
  iconUrl: string | null;
  items: RawItem[];
}

type Obj = Record<string, unknown>;

const ARRAY_TAGS = new Set(['item', 'entry', 'link', 'category', 'media:content', 'media:thumbnail', 'enclosure', 'author']);

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  processEntities: true,
  htmlEntities: true,
  isArray: (name: string) => ARRAY_TAGS.has(name),
});

const builder = new XMLBuilder({ ignoreAttributes: false, attributeNamePrefix: '@_', textNodeName: '#text' });

function arr(v: unknown): Obj[] {
  if (v == null) return [];
  return (Array.isArray(v) ? v : [v]).filter((x): x is Obj => !!x && typeof x === 'object');
}

function first(v: unknown): unknown {
  return Array.isArray(v) ? v[0] : v;
}

function text(v: unknown): string | null {
  v = first(v);
  if (v == null) return null;
  if (typeof v === 'string') return v.trim() || null;
  if (typeof v === 'number') return String(v);
  if (typeof v === 'object') {
    const o = v as Obj;
    if (o['#text'] != null) return String(o['#text']).trim() || null;
    const inner = { ...o };
    for (const k of Object.keys(inner)) if (k.startsWith('@_')) delete inner[k];
    if (!Object.keys(inner).length) return null;
    const rebuilt = String(builder.build(inner.div ?? inner)).trim();
    return rebuilt || null;
  }
  return null;
}

function attr(v: unknown, name: string): string | null {
  const o = first(v);
  if (!o || typeof o !== 'object') return null;
  const value = (o as Obj)[`@_${name}`];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function mediaImage(node: Obj): string | null {
  const group = first(node['media:group']) as Obj | undefined;
  for (const scope of [node, group].filter(Boolean) as Obj[]) {
    for (const c of arr(scope['media:content'])) {
      const medium = attr(c, 'medium');
      const type = attr(c, 'type') ?? '';
      if (medium === 'image' || type.startsWith('image/') || (!medium && !type && /\.(jpe?g|png|webp|gif|avif)(\?|$)/i.test(attr(c, 'url') ?? ''))) {
        const url = attr(c, 'url');
        if (url) return url;
      }
    }
    const thumb = attr(scope['media:thumbnail'], 'url');
    if (thumb) return thumb;
  }
  for (const e of arr(node.enclosure)) {
    if ((attr(e, 'type') ?? '').startsWith('image/')) return attr(e, 'url');
  }
  for (const l of arr(node.link)) {
    if (attr(l, 'rel') === 'enclosure' && (attr(l, 'type') ?? '').startsWith('image/')) return attr(l, 'href');
  }
  return attr(node['itunes:image'], 'href');
}

function contentOf(value: string | null): { content: string | null; contentIsHtml: boolean } {
  return { content: value, contentIsHtml: !!value && looksLikeHtml(value) };
}

function rssItems(items: Obj[], lang: string | null): RawItem[] {
  return items.map((i) => {
    const guid = text(i.guid);
    const permalink = attr(i.guid, 'isPermaLink') !== 'false' && guid && /^https?:\/\//.test(guid) ? guid : null;
    const body = text(i['content:encoded']) ?? text(i.description);
    return {
      title: text(i.title),
      link: text(i.link) ?? permalink,
      guid,
      ...contentOf(body),
      date: parseDate(text(i.pubDate) ?? text(i['dc:date']) ?? text(i.published) ?? text(i['a10:updated']), { lang }),
      image: mediaImage(i),
      author: text(i['dc:creator']) ?? text(i.author),
      found: {},
    };
  });
}

function atomItems(entries: Obj[], lang: string | null): RawItem[] {
  return entries.map((e) => {
    const links = arr(e.link);
    const alternate = links.find((l) => !attr(l, 'rel') || attr(l, 'rel') === 'alternate') ?? links[0];
    const group = first(e['media:group']) as Obj | undefined;
    const body = text(e.content) ?? text(e.summary) ?? (group ? text(group['media:description']) : null);
    const authorNode = first(e.author) as Obj | undefined;
    return {
      title: text(e.title),
      link: alternate ? attr(alternate, 'href') : null,
      guid: text(e.id),
      ...contentOf(body),
      date: parseDate(text(e.published) ?? text(e.updated), { lang }),
      image: mediaImage(e),
      author: authorNode ? text(authorNode.name) : null,
      found: {},
    };
  });
}

function parseJsonFeed(body: string): ParsedFeed | null {
  let doc: Obj;
  try {
    doc = JSON.parse(body) as Obj;
  } catch {
    return null;
  }
  if (!/jsonfeed\.org/.test(String(doc.version ?? '')) || !Array.isArray(doc.items)) return null;
  const items = arr(doc.items).map((i): RawItem => {
    const html = typeof i.content_html === 'string' ? i.content_html : null;
    const plain = typeof i.content_text === 'string' ? i.content_text : typeof i.summary === 'string' ? i.summary : null;
    const authors = arr(i.authors);
    return {
      title: typeof i.title === 'string' ? i.title : null,
      link: typeof i.url === 'string' ? i.url : typeof i.external_url === 'string' ? i.external_url : null,
      guid: i.id != null ? String(i.id) : null,
      content: html ?? plain,
      contentIsHtml: !!html,
      date: parseDate(String(i.date_published ?? i.date_modified ?? '')),
      image: typeof i.image === 'string' ? i.image : typeof i.banner_image === 'string' ? i.banner_image : null,
      author: (authors[0]?.name as string | undefined) ?? ((i.author as Obj | undefined)?.name as string | undefined) ?? null,
      found: {},
    };
  });
  return {
    format: 'json',
    title: typeof doc.title === 'string' ? doc.title : null,
    link: typeof doc.home_page_url === 'string' ? doc.home_page_url : null,
    description: typeof doc.description === 'string' ? doc.description : null,
    iconUrl: typeof doc.icon === 'string' ? doc.icon : typeof doc.favicon === 'string' ? doc.favicon : null,
    items,
  };
}

export function parseFeed(body: string, feedUrl: string): ParsedFeed {
  const trimmed = body.trimStart();
  if (trimmed.startsWith('{')) {
    const json = parseJsonFeed(trimmed);
    if (json) return json;
    throw new Error('Ce JSON n’est pas un JSON Feed.');
  }
  let doc: Obj;
  try {
    doc = parser.parse(trimmed) as Obj;
  } catch {
    throw new Error('Flux XML illisible.');
  }
  const rss = first(doc.rss) as Obj | undefined;
  const rdf = first(doc['rdf:RDF']) as Obj | undefined;
  const atom = first(doc.feed) as Obj | undefined;

  if (rss || rdf) {
    const root = (rss ?? rdf)!;
    const channel = (first(root.channel) ?? {}) as Obj;
    const lang = text(channel.language);
    const link = text(channel.link) ?? attr(channel['atom:link'], 'href');
    const items = arr(channel.item).length ? arr(channel.item) : arr(root.item);
    return {
      format: 'rss',
      title: text(channel.title),
      link: absolutize(link, feedUrl),
      description: text(channel.description),
      iconUrl: absolutize(text((first(channel.image) as Obj | undefined)?.url), feedUrl),
      items: rssItems(items, lang),
    };
  }
  if (atom) {
    const links = arr(atom.link);
    const alternate = links.find((l) => attr(l, 'rel') === 'alternate' || !attr(l, 'rel'));
    return {
      format: 'atom',
      title: text(atom.title),
      link: absolutize(alternate ? attr(alternate, 'href') : null, feedUrl),
      description: text(atom.subtitle),
      iconUrl: absolutize(text(atom.icon) ?? text(atom.logo), feedUrl),
      items: atomItems(arr(atom.entry), attr(atom, 'xml:lang')),
    };
  }
  throw new Error('Format de flux non reconnu (RSS, Atom ou JSON Feed attendu).');
}
