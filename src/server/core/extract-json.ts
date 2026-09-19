// Maps JSON APIs (or JSON embedded in a page) to feed items.
import * as cheerio from 'cheerio';
import type { FieldKey, JsonFields } from '../../shared/types.js';
import { parseDate } from './dates.js';
import type { RawItem } from './extract-html.js';
import { looksLikeHtml } from './html.js';

export function parsePath(path: string): Array<string | number> {
  const out: Array<string | number> = [];
  const re = /\["([^"]+)"\]|\[(\d+)\]|([^.[\]]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(path))) {
    if (m[1] !== undefined) out.push(m[1]);
    else if (m[2] !== undefined) out.push(Number(m[2]));
    else out.push(m[3]);
  }
  return out;
}

export function getPath(value: unknown, path: string): unknown {
  let cur: unknown = value;
  for (const key of parsePath(path.trim())) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string | number, unknown>)[key];
  }
  return cur;
}

function scalarText(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) {
    for (const x of v) {
      const t = scalarText(x);
      if (t) return t;
    }
    return null;
  }
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    for (const k of ['rendered', 'url', 'href', 'src', 'name', 'title', 'text', 'value', '#text']) {
      if (typeof o[k] === 'string' || typeof o[k] === 'number') return String(o[k]);
    }
  }
  return null;
}

/** A plain path ("data.title") or a template ("https://site/{{slug}}"). */
export function readJsonField(item: unknown, spec: string): string | null {
  const s = spec.trim();
  if (!s) return null;
  if (s.includes('{{')) {
    const out = s.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, p: string) => scalarText(getPath(item, p)) ?? '');
    return out.trim() || null;
  }
  const t = scalarText(getPath(item, s));
  return t?.trim() || null;
}

export function jsonFromHtml(html: string, selector: string): unknown {
  const $ = cheerio.load(html);
  const el = $(selector).first();
  if (!el.length) throw new Error(`Aucun élément « ${selector} » dans la page.`);
  const raw = (el.html() ?? el.text()).trim();
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`Le contenu de « ${selector} » n’est pas du JSON valide.`);
  }
}

export function parseJsonBody(body: string): unknown {
  try {
    return JSON.parse(body.replace(/^\uFEFF/, '').replace(/^\)\]\}',?\s*/, ''));
  } catch {
    throw new Error('La réponse n’est pas du JSON valide.');
  }
}

export function extractJsonItems(root: unknown, source: { itemsPath: string; fields: JsonFields }, lang: string | null, limit = 300): RawItem[] {
  let list = source.itemsPath.trim() ? getPath(root, source.itemsPath) : root;
  if (list && typeof list === 'object' && !Array.isArray(list)) list = Object.values(list);
  if (!Array.isArray(list)) {
    throw new Error(
      source.itemsPath.trim()
        ? `Aucune liste trouvée au chemin « ${source.itemsPath} ».`
        : 'La racine du JSON n’est pas une liste : indiquez le chemin des éléments.',
    );
  }
  return list.slice(0, limit).map((item) => {
    const found: RawItem['found'] = {};
    const get = (key: FieldKey) => {
      const spec = source.fields[key];
      if (!spec) return null;
      const v = readJsonField(item, spec);
      if (v) found[key] = true;
      return v;
    };
    const content = get('description');
    return {
      title: get('title'),
      link: get('link'),
      content,
      contentIsHtml: !!content && looksLikeHtml(content),
      date: parseDate(get('date'), { lang }),
      image: get('image'),
      author: get('author'),
      found,
    };
  });
}

// ---- Detection ---------------------------------------------------------------------------------

interface ArrayHit {
  path: string;
  arr: Record<string, unknown>[];
}

function joinPath(base: string, key: string): string {
  if (/^[A-Za-z_$][\w$-]*$/.test(key)) return base ? `${base}.${key}` : key;
  return `${base}["${key.replace(/"/g, '')}"]`;
}

function findArrays(value: unknown, path: string, out: ArrayHit[], depth: number) {
  if (depth > 7 || out.length > 100) return;
  if (Array.isArray(value)) {
    const objects = value.filter((v): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v));
    if (value.length >= 2 && objects.length >= value.length * 0.8) out.push({ path, arr: objects });
    return;
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) findArrays(v, joinPath(path, k), out, depth + 1);
  }
}

function flatten(obj: unknown, prefix: string, depth: number, out: Map<string, unknown>) {
  if (depth > 3 || !obj || typeof obj !== 'object') return;
  if (Array.isArray(obj)) {
    if (obj.length && typeof obj[0] === 'object') flatten(obj[0], `${prefix}[0]`, depth + 1, out);
    else if (obj.length) out.set(`${prefix}[0]`, obj[0]);
    return;
  }
  for (const [k, v] of Object.entries(obj)) {
    const p = joinPath(prefix, k);
    if (v && typeof v === 'object') flatten(v, p, depth + 1, out);
    else if (!out.has(p)) out.set(p, v);
  }
}

const GENERIC_LEAF = /^(rendered|value|text|#text|raw|content|href|url|src|name)$/i;

function meaningfulKey(path: string): { leaf: string; parent: string } {
  const parts = parsePath(path).filter((p): p is string => typeof p === 'string');
  const leaf = parts[parts.length - 1] ?? '';
  const parent = parts[parts.length - 2] ?? '';
  return { leaf, parent };
}

const FIELD_PATTERNS: Record<FieldKey, RegExp> = {
  title: /^(title|name|headline|subject|label|titre|nom|heading)$/i,
  link: /^(url|link|href|permalink|web_?url|html_?url|canonical_?url|share_?url|absolute_?url|full_?url|link_?url|slug|path)$/i,
  description: /^(description|summary|excerpt|content|body|text|abstract|snippet|selftext|resume|chapo|lead|teaser|intro|message)$/i,
  date: /^(date|time|published|created|updated|posted|timestamp|pub_?date|release_?date|published_?at|created_?at|updated_?at|created_?utc|date_?gmt|publishedat|createdat|updatedat|datepublished|datecreated)$/i,
  image: /^(image|img|thumbnail|thumb|cover|picture|photo|poster|preview|media|icon|image_?url|thumbnail_?url|cover_?url|featured_?image)$/i,
  author: /^(author|creator|by|user|username|owner|writer|artist|author_?name)$/i,
};

function valueFits(key: FieldKey, v: unknown): boolean {
  if (key === 'date') return (typeof v === 'string' || typeof v === 'number') && parseDate(String(v)) !== null;
  if (typeof v !== 'string') return false;
  const s = v.trim();
  switch (key) {
    case 'title':
      return s.length >= 2 && s.length <= 400;
    case 'link':
      return /^https?:\/\//i.test(s) || s.startsWith('/') || /^[\w-]+$/.test(s);
    case 'image':
      return /^https?:\/\//i.test(s) || s.startsWith('/');
    case 'description':
      return s.length >= 15;
    case 'author':
      return s.length >= 2 && s.length <= 100 && !/^https?:\/\//i.test(s);
  }
}

const AUTHOR_PARENT = /^(author|creator|user|owner|by|writer|artist|uploader|poster)$/i;
const AUTHOR_LEAF = /^(name|login|username|display_?name|full_?name|handle)$/i;
const API_URL = /\/\/api\.|\/api\/|\/v\d+\//i;
const PAGE_LINK_LEAF = /^(html_?url|web_?url|permalink|link|canonical_?url|share_?url)$/i;

function fieldScore(key: FieldKey, path: string, value: unknown): number {
  const { leaf, parent } = meaningfulKey(path);
  const name = GENERIC_LEAF.test(leaf) && parent ? parent : leaf;
  let score = 0;
  if (key === 'author' && AUTHOR_PARENT.test(parent) && AUTHOR_LEAF.test(leaf)) score = 3.5;
  else if (FIELD_PATTERNS[key].test(name)) score = 3;
  else if (FIELD_PATTERNS[key].test(leaf)) score = 2;
  if (!score || !valueFits(key, value)) return 0;
  score -= parsePath(path).length * 0.2;
  if (typeof value === 'string') {
    if (key === 'link') {
      if (/^https?:/i.test(value)) score += 1;
      // An API endpoint is not the page a reader wants to open.
      if (API_URL.test(value)) score -= 1.5;
      if (PAGE_LINK_LEAF.test(leaf)) score += 0.5;
      if (/^(slug|path)$/i.test(name)) score -= 1.5;
    }
    if (key === 'image' && /\.(jpe?g|png|webp|gif|avif)(\?|$)/i.test(value)) score += 1;
  }
  if (key === 'date' && /publi/i.test(leaf)) score += 0.5;
  return score;
}

export function guessJsonFields(arr: Record<string, unknown>[]): JsonFields {
  const flat = new Map<string, unknown>();
  for (const item of arr.slice(0, 8)) flatten(item, '', 0, flat);
  const fields: JsonFields = {};
  const used = new Set<string>();
  for (const key of ['title', 'link', 'date', 'image', 'description', 'author'] as FieldKey[]) {
    let best: { path: string; score: number } | null = null;
    for (const [path, value] of flat) {
      if (used.has(path)) continue;
      const score = fieldScore(key, path, value);
      if (score > 0 && (!best || score > best.score)) best = { path, score };
    }
    if (best) {
      fields[key] = best.path;
      used.add(best.path);
    }
  }
  return fields;
}

/** Candidate lists in a JSON document, best first. */
export function detectJsonLists(root: unknown, max = 4): Array<{ itemsPath: string; fields: JsonFields; count: number; score: number }> {
  const hits: ArrayHit[] = [];
  findArrays(root, '', hits, 0);
  return hits
    .map((h) => {
      const fields = guessJsonFields(h.arr);
      const n = Object.keys(fields).length;
      const score = Math.sqrt(h.arr.length) * (1 + n) * (fields.title ? 2 : 1) * (fields.link ? 1.5 : 1);
      return { itemsPath: h.path, fields, count: h.arr.length, score };
    })
    .filter((c) => c.fields.title || c.fields.link || c.fields.description)
    .sort((x, y) => y.score - x.score)
    .slice(0, max);
}
