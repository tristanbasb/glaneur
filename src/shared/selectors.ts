// Selector generation that works the same on a browser DOM and on a cheerio tree.
import { classWeight, cssEscape, HOOK_ATTRS, isUsableAttrValue, isUsableClass, isUsableId, moduleClassPrefix } from './css.js';

export interface DomAdapter<N> {
  tag(n: N): string;
  classes(n: N): string[];
  attr(n: N, name: string): string | null;
  parent(n: N): N | null;
  children(n: N): N[];
  /** scope null = whole document; otherwise descendants of scope only. */
  queryAll(scope: N | null, selector: string): N[];
  text(n: N): string;
}

export const SKIP_TAGS = new Set([
  'script', 'style', 'noscript', 'template', 'link', 'meta', 'br', 'hr', 'svg', 'path', 'g', 'use', 'defs',
  'symbol', 'source', 'track', 'input', 'option', 'select', 'textarea', 'iframe', 'head', 'title', 'base',
  'wbr', 'col', 'colgroup',
]);

export function normText(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

export function safeQuery<N>(a: DomAdapter<N>, scope: N | null, selector: string): N[] {
  try {
    return a.queryAll(scope, selector);
  } catch {
    return [];
  }
}

export function* descendants<N>(a: DomAdapter<N>, root: N): Generator<N> {
  const stack = [...a.children(root)].reverse();
  while (stack.length) {
    const n = stack.pop()!;
    yield n;
    const kids = a.children(n);
    for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]);
  }
}

export function isAncestor<N>(a: DomAdapter<N>, ancestor: N, node: N): boolean {
  for (let cur: N | null = node; cur; cur = a.parent(cur)) if (cur === ancestor) return true;
  return false;
}

/** Best classes (max 2) as a selector fragment, or a CSS-module attribute match. */
export function classPart(classes: string[], max = 2): string {
  const usable = classes.filter(isUsableClass);
  if (usable.length) {
    return [...usable]
      .sort((x, y) => classWeight(y) - classWeight(x))
      .slice(0, max)
      .map((c) => '.' + cssEscape(c))
      .join('');
  }
  for (const c of classes) {
    const prefix = moduleClassPrefix(c);
    if (prefix) return `[class*="${prefix}"]`;
  }
  return '';
}

function hookAttrPart<N>(a: DomAdapter<N>, n: N): string {
  for (const name of HOOK_ATTRS) {
    const v = a.attr(n, name);
    if (v && isUsableAttrValue(v)) return `[${name}="${v.replace(/"/g, '\\"')}"]`;
  }
  return '';
}

/** Tag plus distinguishing classes or hook attribute — no positional information. */
export function signature<N>(a: DomAdapter<N>, n: N, classes?: string[]): string {
  const tag = a.tag(n);
  const cls = classPart(classes ?? a.classes(n));
  return cls ? tag + cls : tag + hookAttrPart(a, n);
}

function nthOfType<N>(a: DomAdapter<N>, n: N): { index: number; count: number } {
  const p = a.parent(n);
  if (!p) return { index: 1, count: 1 };
  const tag = a.tag(n);
  const same = a.children(p).filter((c) => a.tag(c) === tag);
  return { index: same.indexOf(n) + 1, count: same.length };
}

/** A selector matching only `n` in the document, kept as short as possible. */
export function uniqueSelector<N>(a: DomAdapter<N>, n: N): string {
  const parts: string[] = [];
  for (let cur: N | null = n; cur; cur = a.parent(cur)) {
    const tag = a.tag(cur);
    if (tag === 'body' || tag === 'html') {
      parts.unshift(tag);
      break;
    }
    const id = a.attr(cur, 'id');
    if (id && isUsableId(id)) {
      parts.unshift('#' + cssEscape(id));
      if (safeQuery(a, null, parts.join(' > ')).length === 1) return parts.join(' > ');
      continue;
    }
    parts.unshift(signature(a, cur));
    if (safeQuery(a, null, parts.join(' > ')).length === 1) return parts.join(' > ');
    const { index, count } = nthOfType(a, cur);
    if (count > 1) {
      parts[0] += `:nth-of-type(${index})`;
      if (safeQuery(a, null, parts.join(' > ')).length === 1) return parts.join(' > ');
    }
  }
  return parts.join(' > ');
}

function unique<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}

/** A selector matching all `members` and as few other elements as possible. */
export function groupSelector<N>(a: DomAdapter<N>, members: N[]): string {
  if (!members.length) return '';
  const tags = unique(members.map((m) => a.tag(m)));
  const tag = tags.length === 1 ? tags[0] : '*';
  const shared = members
    .map((m) => a.classes(m))
    .reduce((acc, cls) => acc.filter((c) => cls.includes(c)));
  let base = tag + classPart(shared);
  if (base === tag) {
    const hooks = unique(members.map((m) => hookAttrPart(a, m)));
    if (hooks.length === 1 && hooks[0]) base += hooks[0];
  }

  const candidates = [base];
  const parents = unique(members.map((m) => a.parent(m)));
  if (parents.length === 1 && parents[0]) {
    candidates.push(`${signature(a, parents[0])} > ${base}`);
    candidates.push(`${uniqueSelector(a, parents[0])} > ${base}`);
  } else {
    const psigs = unique(parents.map((p) => (p ? signature(a, p) : '')));
    if (psigs.length === 1 && psigs[0]) {
      candidates.push(`${psigs[0]} > ${base}`);
      const gps = unique(parents.map((p) => (p ? a.parent(p) : null)));
      if (gps.length === 1 && gps[0]) candidates.push(`${uniqueSelector(a, gps[0])} > ${psigs[0]} > ${base}`);
      else {
        const gpsigs = unique(gps.map((g) => (g ? signature(a, g) : '')));
        if (gpsigs.length === 1 && gpsigs[0]) candidates.push(`${gpsigs[0]} > ${psigs[0]} > ${base}`);
      }
    }
  }

  const memberSet = new Set(members);
  let best = { sel: base, score: -1 };
  for (const sel of candidates) {
    const matches = safeQuery(a, null, sel);
    if (!matches.length) continue;
    const hit = matches.filter((m) => memberSet.has(m)).length;
    const score = (hit / members.length) * (hit / matches.length);
    if (score === 1) return sel;
    if (score > best.score + 1e-9) best = { sel, score };
  }
  return best.sel;
}

/** Candidate selectors (relative to `item`) that could point at `target`. Simplest first. */
export function relativeCandidates<N>(a: DomAdapter<N>, item: N, target: N): string[] {
  if (target === item) return [':scope'];
  const path: N[] = [];
  for (let n: N | null = target; n && n !== item; n = a.parent(n)) path.unshift(n);
  if (!path.length || a.parent(path[0]) !== item) return [];
  const out: string[] = [];
  const last = path[path.length - 1];
  const lastSig = signature(a, last);
  const lastTag = a.tag(last);
  out.push(lastSig);
  if (lastSig !== lastTag) out.push(lastTag);
  if (path.length >= 2) {
    const parentSig = signature(a, path[path.length - 2]);
    out.push(`${parentSig} > ${lastSig}`);
  }
  out.push(':scope > ' + path.map((n) => signature(a, n)).join(' > '));
  out.push(
    ':scope > ' +
      path
        .map((n) => {
          const { index, count } = nthOfType(a, n);
          return signature(a, n) + (count > 1 ? `:nth-of-type(${index})` : '');
        })
        .join(' > '),
  );
  return unique(out);
}

function pathSignature<N>(a: DomAdapter<N>, item: N, el: N): string {
  const sigs: string[] = [];
  for (let n: N | null = el; n && n !== item; n = a.parent(n)) sigs.unshift(signature(a, n));
  return sigs.join('>');
}

export function firstMatch<N>(a: DomAdapter<N>, item: N, selector: string): N | null {
  if (selector === ':scope') return item;
  return safeQuery(a, item, selector)[0] ?? null;
}

/**
 * Pick the relative selector that best reproduces the (item → target) pairs and behaves
 * consistently over all items.
 */
export function consensusSelector<N>(
  a: DomAdapter<N>,
  pairs: Array<{ item: N; target: N }>,
  items: N[],
): { selector: string; coverage: number } | null {
  const hits = new Map<string, number>();
  for (const { item, target } of pairs) {
    for (const c of relativeCandidates(a, item, target)) {
      if (firstMatch(a, item, c) === target) hits.set(c, (hits.get(c) ?? 0) + 1);
    }
  }
  if (!hits.size) return null;
  const ref = pairs[0];
  const refSig = pathSignature(a, ref.item, ref.target);
  const sample = items.slice(0, 40);
  let best: { selector: string; rank: number; coverage: number } | null = null;
  for (const [selector, h] of hits) {
    let matched = 0;
    let consistent = 0;
    for (const it of sample) {
      const m = firstMatch(a, it, selector);
      if (!m) continue;
      matched++;
      if (pathSignature(a, it, m) === refSig) consistent++;
    }
    const coverage = sample.length ? matched / sample.length : 0;
    const consistency = sample.length ? consistent / sample.length : 0;
    const rank = h * 1000 + Math.round(coverage * 50 + consistency * 50) - selector.length / 1000;
    if (!best || rank > best.rank) best = { selector, rank, coverage };
  }
  return best ? { selector: best.selector, coverage: best.coverage } : null;
}
