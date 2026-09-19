// HTML helpers: URL resolution, text extraction and sanitization of item content.
import * as cheerio from 'cheerio';
import type { AnyNode, Element, Text } from 'domhandler';
import sanitizeHtml from 'sanitize-html';

export function absolutize(url: string | null | undefined, base: string): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (!trimmed || /^(javascript|data|mailto|tel|about|blob):/i.test(trimmed)) return null;
  try {
    const u = new URL(trimmed, base);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}

export function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const BLOCK_TAGS = new Set([
  'address', 'article', 'aside', 'blockquote', 'br', 'dd', 'div', 'dl', 'dt', 'figcaption', 'figure', 'footer',
  'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'li', 'main', 'nav', 'ol', 'p', 'pre', 'section',
  'table', 'tr', 'td', 'th', 'ul',
]);
const SILENT_TAGS = new Set(['script', 'style', 'noscript', 'template', 'svg', 'head', 'iframe', 'button', 'select']);

export function isElement(n: AnyNode | null | undefined): n is Element {
  return !!n && (n.type === 'tag' || n.type === 'script' || n.type === 'style');
}

/** Text content that skips scripts/styles and keeps line breaks between block elements. */
export function nodeText(node: AnyNode): string {
  const parts: string[] = [];
  const walk = (n: AnyNode) => {
    if (n.type === 'text') {
      parts.push((n as Text).data);
      return;
    }
    if (n.type === 'root') {
      for (const child of n.children) walk(child);
      return;
    }
    if (!isElement(n) || n.type !== 'tag') return;
    const tag = n.name.toLowerCase();
    if (SILENT_TAGS.has(tag)) return;
    const block = BLOCK_TAGS.has(tag);
    if (block) parts.push('\n');
    for (const child of n.children) walk(child);
    if (block) parts.push('\n');
  };
  walk(node);
  return parts.join('');
}

/** Normalizes whitespace while keeping paragraph breaks. */
export function cleanMultiline(text: string): string {
  return text
    .replace(/\xa0/g, ' ')
    .split('\n')
    .map((line) => line.replace(/[ \t\f\v\r]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function cleanInline(text: string | null | undefined): string {
  return (text ?? '').replace(/\xa0/g, ' ').replace(/\s+/g, ' ').trim();
}

export function htmlToText(html: string): string {
  const $ = cheerio.load(html, null, false);
  return cleanMultiline($.root().toArray().map(nodeText).join(''));
}

export function textToHtml(text: string): string {
  return cleanMultiline(text)
    .split(/\n{2,}/)
    .map((para) => `<p>${escapeHtml(para).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

export function looksLikeHtml(value: string): boolean {
  return /<\/?[a-z][\w-]*(\s[^>]*)?>/i.test(value);
}

export function largestFromSrcset(srcset: string): string | null {
  let best: string | null = null;
  let bestScore = -1;
  for (const part of srcset.split(/,\s+(?=\S)/)) {
    const [url, descriptor] = part.trim().split(/\s+/);
    if (!url) continue;
    const score = descriptor ? parseFloat(descriptor) * (descriptor.endsWith('x') ? 1000 : 1) : 1;
    if (score > bestScore) {
      best = url;
      bestScore = score;
    }
  }
  return best;
}

const PLACEHOLDER_RE = /(blank|spacer|placeholder|transparent|pixel|lazy|loader)[\w-]*\.(gif|png|svg)/i;

/** Best image URL from an <img>-like attribute getter, handling lazy-loading conventions. */
export function pickImageSource(attr: (name: string) => string | null | undefined): string | null {
  const good = (u: string | null | undefined): u is string => !!u && !/^data:/i.test(u.trim()) && !PLACEHOLDER_RE.test(u);
  const lazy = ['data-src', 'data-lazy-src', 'data-original', 'data-lazy', 'data-url', 'data-hi-res-src', 'data-full-src']
    .map((n) => attr(n))
    .find(good);
  if (lazy) return lazy;
  const src = attr('src');
  if (good(src)) return src;
  const srcset = attr('srcset') || attr('data-srcset') || attr('data-lazy-srcset');
  return srcset ? largestFromSrcset(srcset) : null;
}

export function backgroundImageUrl(style: string | null | undefined): string | null {
  const m = /url\(\s*['"]?([^'")]+)['"]?\s*\)/i.exec(style ?? '');
  return m ? m[1] : null;
}

/** Keeps safe markup only and makes every URL absolute. */
export function sanitizeContent(html: string, baseUrl: string): string {
  return sanitizeHtml(html, {
    allowedTags: [
      'p', 'br', 'a', 'img', 'figure', 'figcaption', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'em', 'strong',
      'b', 'i', 'u', 's', 'sub', 'sup', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'table', 'thead', 'tbody', 'tr', 'th',
      'td', 'hr', 'span', 'div', 'small', 'mark', 'del', 'ins', 'dl', 'dt', 'dd', 'abbr', 'time',
    ],
    allowedAttributes: {
      a: ['href', 'title'],
      img: ['src', 'alt', 'title', 'width', 'height'],
      td: ['colspan', 'rowspan'],
      th: ['colspan', 'rowspan'],
      abbr: ['title'],
      time: ['datetime'],
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    nonTextTags: ['style', 'script', 'textarea', 'option', 'noscript', 'template', 'svg', 'button'],
    transformTags: {
      a: (tagName, attribs) => {
        const href = absolutize(attribs.href, baseUrl);
        return { tagName, attribs: href ? { href, ...(attribs.title ? { title: attribs.title } : {}) } : {} };
      },
      img: (tagName, attribs) => {
        const src = absolutize(pickImageSource((n) => attribs[n]), baseUrl);
        const clean: Record<string, string> = {};
        if (src) {
          clean.src = src;
          clean.alt = attribs.alt ?? '';
        }
        return { tagName, attribs: clean };
      },
    },
    exclusiveFilter: (frame) => frame.tag === 'img' && !frame.attribs.src,
  }).trim();
}
