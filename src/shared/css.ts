// Helpers to decide which classes, ids and attributes make durable CSS selectors.

/** CSS.escape polyfill (https://drafts.csswg.org/cssom/#serialize-an-identifier). */
export function cssEscape(value: string): string {
  const str = String(value);
  const len = str.length;
  const first = str.charCodeAt(0);
  let out = '';
  if (len === 1 && first === 0x2d) return '\\' + str;
  for (let i = 0; i < len; i++) {
    const code = str.charCodeAt(i);
    if (code === 0) {
      out += '\uFFFD';
      continue;
    }
    if (
      (code >= 0x1 && code <= 0x1f) ||
      code === 0x7f ||
      (i === 0 && code >= 0x30 && code <= 0x39) ||
      (i === 1 && code >= 0x30 && code <= 0x39 && first === 0x2d)
    ) {
      out += '\\' + code.toString(16) + ' ';
      continue;
    }
    if (
      code >= 0x80 ||
      code === 0x2d ||
      code === 0x5f ||
      (code >= 0x30 && code <= 0x39) ||
      (code >= 0x41 && code <= 0x5a) ||
      (code >= 0x61 && code <= 0x7a)
    ) {
      out += str.charAt(i);
      continue;
    }
    out += '\\' + str.charAt(i);
  }
  return out;
}

const STATE_WORDS = new Set([
  'active', 'selected', 'current', 'open', 'opened', 'closed', 'hover', 'hovered', 'focus', 'focused',
  'visible', 'invisible', 'hidden', 'show', 'shown', 'hide', 'in', 'out', 'fade', 'fadein', 'collapsed',
  'collapse', 'expanded', 'disabled', 'enabled', 'loaded', 'loading', 'lazy', 'lazyload', 'lazyloaded',
  'lazyloading', 'first', 'last', 'odd', 'even', 'clearfix', 'clear', 'animated', 'animate', 'sticky',
  'fixed', 'checked', 'read', 'unread', 'new', 'sr-only', 'visually-hidden', 'js', 'no-js', 'aos-init',
  'aos-animate', 'wow', 'swiper-slide-active', 'slick-active', 'slick-current', 'ls-is-cached',
]);

const UTILITY_WORDS = new Set([
  'flex', 'grid', 'block', 'inline', 'inline-block', 'inline-flex', 'contents', 'table', 'relative',
  'absolute', 'static', 'truncate', 'italic', 'uppercase', 'lowercase', 'capitalize', 'underline',
  'group', 'peer', 'prose', 'antialiased', 'transform', 'transition', 'border', 'rounded', 'shadow',
  'isolate', 'container', 'mx-auto', 'grow', 'shrink',
]);

const UTILITY_RES = [
  /^-?(m|p)[trblxyse]?-(\d+(\.\d)?|px|auto)$/,
  /^(w|h|min-w|max-w|min-h|max-h|size|basis|top|left|right|bottom|inset(-[xy])?|z|gap(-[xy])?|space-[xy]|translate-[xy]|leading|tracking|rounded(-[trbl]{1,2})?|border(-[trblxy])?|opacity|duration|delay|scale|rotate|order|columns|line-clamp|grid-cols|grid-rows|col-span|row-span|col-start|col-end|row-start|aspect)-([\d.]+|px|full|screen|auto|min|max|fit|none|tight|snug|normal|relaxed|loose|wide|wider|widest|xs|sm|md|lg|xl|[2-9]xl|video|square)$/,
  /^(text|bg|border|from|via|to|ring|fill|stroke|decoration|outline|shadow|divide|placeholder|accent|caret)-(xs|sm|base|lg|[0-9]?xl|left|right|center|justify|start|end|transparent|current|inherit|white|black|(slate|gray|grey|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|primary|secondary|accent|muted|foreground|background)(-\d{2,3})?)$/,
  /^font-(thin|extralight|light|normal|medium|semibold|bold|extrabold|black|sans|serif|mono)$/,
  /^(items|justify|content|self|place-items|place-content|place-self)-(start|end|center|between|around|evenly|stretch|baseline|normal)$/,
  /^(flex|overflow|whitespace|break|object|cursor|select|pointer-events|shrink|grow|list|float|clear|align|display|visibility)-[a-z0-9-]+$/,
  /^(d|u|l|o|is|has|js)-(none|block|flex|inline|grid|table|hidden|sm|md|lg|xl)(-[a-z0-9]+)*$/,
];

function digitGroups(s: string): number {
  return (s.match(/\d+/g) ?? []).length;
}

/** CSS-module class ("Card_title__x9Kd2") → stable prefix ("Card_title__"), otherwise null. */
export function moduleClassPrefix(c: string): string | null {
  const m = /^([A-Za-z][\w-]*?_{2,3})([A-Za-z0-9_-]{5,8})$/.exec(c);
  if (!m) return null;
  const suffix = m[2];
  const prefix = m[1];
  if (!prefix.replace(/_+$/, '').includes('_') && !/[A-Z]/.test(prefix)) return null;
  if (/\d/.test(suffix) || (suffix.match(/[A-Z]/g) ?? []).length >= 2) return prefix;
  return null;
}

function isUtilityClass(lower: string): boolean {
  if (UTILITY_WORDS.has(lower)) return true;
  return UTILITY_RES.some((re) => re.test(lower));
}

/** True when a class is likely stable across page loads and meaningful across similar elements. */
export function isUsableClass(c: string): boolean {
  if (!c || c.length > 48) return false;
  if (!/^-?[A-Za-z_][\w-]*$/.test(c)) return false;
  const lower = c.toLowerCase();
  if (STATE_WORDS.has(lower)) return false;
  const dash = lower.indexOf('-');
  if (dash > 0 && /^(is|has|js)$/.test(lower.slice(0, dash)) && STATE_WORDS.has(lower.slice(dash + 1))) return false;
  if (/^(ng|_ng|data-v|v|x)-/.test(lower) && /\d|star-inserted|cloak/.test(lower)) return false;
  if (/[-_]\d+$/.test(c)) return false;
  if (/^(css|jsx|svelte|astro|jss|sc|emotion|tw)-/i.test(c)) return false;
  if (/^jss\d/.test(c)) return false;
  if (moduleClassPrefix(c)) return false;
  if (!/[-_]/.test(c) && digitGroups(c) >= 2) return false;
  if (/^[a-zA-Z]{5,8}$/.test(c) && (c.match(/[A-Z]/g) ?? []).length >= 2 && /[a-z][A-Z]/.test(c)) return false;
  if (isUtilityClass(lower)) return false;
  return true;
}

const SEMANTIC_RE =
  /(title|titre|headline|heading|post|article|entry|item|card|news|story|teaser|list|feed|result|product|event|excerpt|summary|desc|date|time|author|byline|thumb|image|media|link|content|body|text|name|meta|price|message)/i;

/** Higher = better candidate to appear in a selector. */
export function classWeight(c: string): number {
  let w = 1;
  if (SEMANTIC_RE.test(c)) w += 2;
  if (c.length >= 4) w += 0.5;
  if (c.length > 30) w -= 1;
  if (/^(col|row|span|grid|wrap|wrapper|inner|outer|container|box|block|section|d-|u-|l-|o-)/i.test(c)) w -= 0.8;
  return w;
}

export function isUsableId(id: string): boolean {
  if (!id || id.length > 40) return false;
  if (!/^[A-Za-z][\w-]*$/.test(id)) return false;
  if (/\d{3,}/.test(id) || /[-_]\d+$/.test(id) || digitGroups(id) >= 2) return false;
  if (/^(ember|react|radix|headlessui|mui|rc|yui|ext|gwt|uid|ui-id|aria)/i.test(id) && /\d/.test(id)) return false;
  return true;
}

/** Attributes that sites use as stable hooks. */
export const HOOK_ATTRS = ['itemprop', 'data-testid', 'data-test', 'data-qa', 'data-cy', 'data-component', 'data-type', 'role'];

export function isUsableAttrValue(v: string): boolean {
  return !!v && v.length <= 40 && /^[\w\s:.-]+$/.test(v) && !/\d{3,}/.test(v) && digitGroups(v) < 2;
}
