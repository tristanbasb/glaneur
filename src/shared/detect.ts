// Finds repeated, article-like blocks in a page and guesses where each field lives.
import { classWeight, isUsableClass } from './css.js';
import { consensusSelector, descendants, type DomAdapter, groupSelector, isAncestor, normText, safeQuery, signature, SKIP_TAGS } from './selectors.js';
import type { FieldRules } from './types.js';

export interface DetectedList<N> {
  members: N[];
  selector: string;
  score: number;
  fields: FieldRules;
}

const NOISE_RE =
  /(^|[\s_-])(nav|navbar|navigation|menu|menus|megamenu|submenu|footer|header|masthead|breadcrumbs?|pagination|pager|social|share|sharing|cookies?|consent|sidebar|widget|related|tagcloud|tags|categories|lang|langs|language|toolbar|dropdown|skip)([\s_-]|$)/i;
const NOISE_TAGS = new Set(['nav', 'header', 'footer', 'aside', 'form', 'menu']);
const NOISE_ROLES = new Set(['navigation', 'menu', 'menubar', 'banner', 'contentinfo']);
const MAIN_RE = /(^|[\s_-])(main|content|contenu|articles|posts|feed|results|listing)([\s_-]|$)/i;
const HAS_LETTER = /\p{L}/u;

export function validHref(href: string | null): href is string {
  return !!href && !href.startsWith('#') && !/^(javascript|mailto|tel|data):/i.test(href.trim());
}

interface Group<N> {
  parent: N;
  members: N[];
  /** Parent signature + member signature: groups sharing it are the same component repeated. */
  key: string;
}

function collectGroups<N>(a: DomAdapter<N>, root: N): Group<N>[] {
  const groups: Group<N>[] = [];
  const stack: N[] = [root];
  let visited = 0;
  while (stack.length && visited < 40000) {
    const el = stack.pop()!;
    visited++;
    const kids = a.children(el).filter((k) => !SKIP_TAGS.has(a.tag(k)));
    for (const k of kids) stack.push(k);
    if (kids.length < 3) continue;

    const byTag = new Map<string, N[]>();
    for (const k of kids) {
      const list = byTag.get(a.tag(k));
      if (list) list.push(k);
      else byTag.set(a.tag(k), [k]);
    }
    const parentSig = signature(a, el);
    for (const [tag, list] of byTag) {
      if (list.length < 3) continue;
      const freq = new Map<string, number>();
      for (const k of list) {
        for (const c of new Set(a.classes(k))) if (isUsableClass(c)) freq.set(c, (freq.get(c) ?? 0) + 1);
      }
      const ranked = [...freq.entries()].sort((x, y) => y[1] - x[1] || classWeight(y[0]) - classWeight(x[0]));
      const common = ranked.filter(([, f]) => f >= list.length * 0.6).slice(0, 2).map(([c]) => c);
      if (common.length) {
        const members = list.filter((k) => common.every((c) => a.classes(k).includes(c)));
        if (members.length >= 3) groups.push({ parent: el, members, key: `${parentSig}>${tag}.${[...common].sort().join('.')}` });
        continue;
      }
      // No dominant class: items may alternate with helper rows (e.g. tr.athing + tr.spacer).
      let covered = false;
      for (const [c, f] of ranked.slice(0, 3)) {
        if (f < 3) break;
        if (f >= list.length * 0.3) covered = true;
        groups.push({ parent: el, members: list.filter((k) => a.classes(k).includes(c)), key: `${parentSig}>${tag}.${c}` });
      }
      if (!covered) groups.push({ parent: el, members: list, key: `${parentSig}>${tag}` });
    }
  }
  return groups;
}

/** The same component repeated in several containers (e.g. one grid per section) becomes one group. */
function mergeRepeatedGroups<N>(a: DomAdapter<N>, groups: Group<N>[]): Group<N>[] {
  const byKey = new Map<string, Group<N>[]>();
  for (const g of groups) {
    const list = byKey.get(g.key);
    if (list) list.push(g);
    else byKey.set(g.key, [g]);
  }
  const out: Group<N>[] = [];
  for (const list of byKey.values()) {
    const parents = list.map((g) => g.parent);
    const nested = parents.some((p, i) => parents.some((q, j) => i !== j && isAncestor(a, p, q)));
    if (list.length < 2 || nested) out.push(...list);
    else out.push({ parent: list[0].parent, members: list.flatMap((g) => g.members), key: list[0].key });
  }
  return out;
}

interface MemberStats {
  hasLink: boolean;
  firstHref: string | null;
  linkText: number;
  text: number;
  heading: boolean;
  img: boolean;
  time: boolean;
}

function memberStats<N>(a: DomAdapter<N>, m: N): MemberStats {
  const s: MemberStats = { hasLink: false, firstHref: null, linkText: 0, text: Math.min(normText(a.text(m)).length, 600), heading: false, img: false, time: false };
  const visit = (n: N) => {
    const tag = a.tag(n);
    if (tag === 'a') {
      const href = a.attr(n, 'href');
      if (validHref(href)) {
        if (!s.hasLink) s.firstHref = href;
        s.hasLink = true;
        s.linkText = Math.max(s.linkText, Math.min(normText(a.text(n)).length, 200));
      }
    } else if (/^h[1-6]$/.test(tag)) s.heading = true;
    else if (tag === 'img' || tag === 'picture') s.img = true;
    else if (tag === 'time') s.time = true;
  };
  visit(m);
  let count = 0;
  for (const d of descendants(a, m)) {
    visit(d);
    if (++count > 500) break;
  }
  return s;
}

function contextOf<N>(a: DomAdapter<N>, el: N): { noise: boolean; main: boolean } {
  let noise = false;
  let main = false;
  let depth = 0;
  for (let cur: N | null = el; cur && depth < 12; cur = a.parent(cur), depth++) {
    const tag = a.tag(cur);
    if (tag === 'body' || tag === 'html') break;
    const role = a.attr(cur, 'role') ?? '';
    if (tag === 'main' || role === 'main') main = true;
    if (NOISE_TAGS.has(tag) || NOISE_ROLES.has(role)) noise = true;
    const idc = `${a.attr(cur, 'id') ?? ''} ${a.classes(cur).join(' ')}`;
    if (NOISE_RE.test(idc)) noise = true;
    else if (MAIN_RE.test(idc)) main = true;
  }
  return { noise, main };
}

function scoreGroup<N>(a: DomAdapter<N>, g: Group<N>): number {
  const stats = g.members.slice(0, 30).map((m) => memberStats(a, m));
  const n = stats.length;
  const linked = stats.filter((s) => s.hasLink);
  const linkRatio = linked.length / n;
  const avgText = stats.reduce((t, s) => t + s.text, 0) / n;
  if (linkRatio < 0.5 || avgText < 15) return 0;
  const avgLinkText = linked.reduce((t, s) => t + s.linkText, 0) / Math.max(1, linked.length);
  const distinct = new Set(linked.map((s) => s.firstHref)).size / Math.max(1, linked.length);

  let score = Math.log2(g.members.length + 1) * Math.log2(avgText + 2) * (0.4 + linkRatio);
  if (stats.filter((s) => s.heading).length / n > 0.5) score *= 1.6;
  if (stats.filter((s) => s.img).length / n > 0.5) score *= 1.25;
  if (stats.filter((s) => s.time).length / n > 0.3) score *= 1.3;
  if (avgLinkText < 12) score *= 0.45;
  if (distinct < 0.6) score *= 0.35;
  if (avgText > 2500) score *= 0.5;
  const ctx = contextOf(a, g.parent);
  if (ctx.noise) score *= 0.35;
  if (ctx.main) score *= 1.2;
  return score;
}

function overlaps<N>(a: DomAdapter<N>, xs: N[], ys: N[]): boolean {
  if (Math.min(xs.length, ys.length) / Math.max(xs.length, ys.length) < 0.5) return false;
  const within = (nodes: N[], set: Set<N>) => {
    const sample = nodes.slice(0, 12);
    const inside = sample.filter((n) => {
      for (let cur: N | null = n; cur; cur = a.parent(cur)) if (set.has(cur)) return true;
      return false;
    });
    return inside.length / sample.length;
  };
  return within(ys, new Set(xs)) >= 0.6 || within(xs, new Set(ys)) >= 0.6;
}

/** Groups of repeated, article-like blocks (members + score), best first, without overlaps. */
export function findListGroups<N>(a: DomAdapter<N>, root: N, max = 5): Array<{ members: N[]; score: number }> {
  const scored = mergeRepeatedGroups(a, collectGroups(a, root))
    .map((g) => ({ g, score: scoreGroup(a, g) }))
    .filter((x) => x.score > 0)
    .sort((x, y) => y.score - x.score);
  const kept: typeof scored = [];
  for (const x of scored) {
    if (kept.some((k) => overlaps(a, k.g.members, x.g.members))) continue;
    kept.push(x);
    if (kept.length >= max) break;
  }
  return kept.map(({ g, score }) => ({ members: g.members, score: Math.round(score * 10) / 10 }));
}

/** Repeated blocks that look like a list of articles, with selectors and guessed fields. */
export function detectLists<N>(a: DomAdapter<N>, root: N, max = 5): DetectedList<N>[] {
  return findListGroups(a, root, max).map(({ members, score }) => ({
    members,
    score,
    selector: groupSelector(a, members),
    fields: inferFields(a, members),
  }));
}

// ---- Field guessing ---------------------------------------------------------------------------

const TITLE_CLASS_RE = /(^|[\s_-])(title|titre|headline|heading)([\s_-]|$)|__title|headline/i;
const DATE_CLASS_RE = /(date|time|publi|posted|dateline|heure)/i;
const DESC_STRONG_RE = /(desc|summary|excerpt|chapo|chapeau|intro|teaser|lead|resume|résumé|abstract|snippet|standfirst|subtitle|sous-titre)/i;
const DESC_WEAK_RE = /(body|text|content)/i;
const DESC_NEGATIVE_RE = /(image|img|photo|picture|caption|credit|copyright|disclosure|meta|author|byline|date|time|tag|categor|share|social|comment|button|btn|badge|label|price|rating|more)/i;
const AUTHOR_CLASS_RE = /(^|[\s_-])(author|auteur|byline|writer|signature)([\s_-]|$)|__author|-author|author-/i;
export const DATE_TEXT_RE =
  /(\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}|\d{4}-\d{2}-\d{2}|il y a|\bago\b|\bhier\b|yesterday|aujourd'hui|today|\d{1,2}(er)?\s+(janv|févr|fevr|mars|avr|mai|juin|juil|août|aout|sept|oct|nov|déc|dec|jan|feb|mar|apr|may|jun|jul|aug|sep)[a-zéû]*\.?\s+\d{2,4}|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4})/i;

function classText<N>(a: DomAdapter<N>, n: N): string {
  return `${a.classes(n).join(' ')} ${a.attr(n, 'itemprop') ?? ''}`;
}

/** Length of a readable text (with letters, within bounds), 0 otherwise. */
function readable<N>(a: DomAdapter<N>, n: N, min = 3, max = 300): number {
  const t = normText(a.text(n));
  return t.length >= min && t.length <= max && HAS_LETTER.test(t) ? t.length : 0;
}

/** When a target is not the first of its kind in the item, descend to a same-text child that is. */
function refineTarget<N>(a: DomAdapter<N>, item: N, target: N): N {
  let cur = target;
  const text = normText(a.text(target));
  for (let depth = 0; depth < 4 && safeQuery(a, item, signature(a, cur))[0] !== cur; depth++) {
    const same = a.children(cur).filter((k) => normText(a.text(k)) === text);
    if (same.length !== 1) break;
    cur = same[0];
  }
  return cur;
}

export function pickTitle<N>(a: DomAdapter<N>, m: N): N | null {
  for (const d of descendants(a, m)) if (/^h[1-6]$/.test(a.tag(d)) && readable(a, d)) return refineTarget(a, m, d);
  let best: N | null = null;
  let bestLen = 0;
  for (const d of descendants(a, m)) {
    const ip = a.attr(d, 'itemprop');
    if (!(TITLE_CLASS_RE.test(a.classes(d).join(' ')) || ip === 'headline' || ip === 'name')) continue;
    const len = readable(a, d);
    if (len > bestLen) {
      best = d;
      bestLen = len;
    }
  }
  if (best) return refineTarget(a, m, best);
  for (const d of descendants(a, m)) {
    if (a.tag(d) !== 'a' || !validHref(a.attr(d, 'href'))) continue;
    const len = readable(a, d);
    if (len > bestLen) {
      best = d;
      bestLen = len;
    }
  }
  if (best) return best;
  return a.tag(m) === 'a' && readable(a, m) ? m : null;
}

export function pickLink<N>(a: DomAdapter<N>, m: N, title: N | null): N | null {
  const isLink = (n: N) => a.tag(n) === 'a' && validHref(a.attr(n, 'href'));
  if (title) {
    if (isLink(title)) return title;
    for (const d of descendants(a, title)) if (isLink(d)) return d;
    const stop = a.parent(m);
    for (let cur = a.parent(title); cur && cur !== stop; cur = a.parent(cur)) if (isLink(cur)) return cur;
  }
  if (isLink(m)) return m;
  for (const d of descendants(a, m)) if (isLink(d)) return d;
  return null;
}

export function pickDate<N>(a: DomAdapter<N>, m: N): N | null {
  for (const d of descendants(a, m)) if (a.tag(d) === 'time') return d;
  for (const d of descendants(a, m)) {
    if (!DATE_CLASS_RE.test(classText(a, d))) continue;
    const len = normText(a.text(d)).length;
    if (len >= 4 && len <= 60) return d;
  }
  for (const d of descendants(a, m)) {
    if (a.children(d).length) continue;
    const t = normText(a.text(d));
    if (t.length <= 60 && DATE_TEXT_RE.test(t)) return d;
  }
  return null;
}

export function pickImage<N>(a: DomAdapter<N>, m: N): N | null {
  for (const d of [m, ...descendants(a, m)]) {
    if (a.tag(d) === 'img') {
      const w = parseInt(a.attr(d, 'width') ?? '', 10);
      if (Number.isFinite(w) && w > 0 && w < 40) continue;
      return d;
    }
    const style = a.attr(d, 'style');
    if (style && /background(-image)?\s*:[^;]*url\(/i.test(style)) return d;
  }
  return null;
}

export function pickDescription<N>(a: DomAdapter<N>, m: N, title: N | null): N | null {
  let best: N | null = null;
  let bestScore = 0;
  for (const d of descendants(a, m)) {
    if (title && (isAncestor(a, d, title) || isAncestor(a, title, d))) continue;
    const cls = classText(a, d);
    if (DESC_NEGATIVE_RE.test(cls)) continue;
    let score = 0;
    if (DESC_STRONG_RE.test(cls)) score += 4;
    else if (DESC_WEAK_RE.test(cls)) score += 1.5;
    if (a.tag(d) === 'p') score += 2;
    if (!score) continue;
    const len = readable(a, d, 25, 5000);
    if (!len) continue;
    score += Math.min(Math.log2(len), 9) / 3;
    if (score > bestScore) {
      best = d;
      bestScore = score;
    }
  }
  return best;
}

export function pickAuthor<N>(a: DomAdapter<N>, m: N): N | null {
  for (const d of descendants(a, m)) {
    const match = a.attr(d, 'rel') === 'author' || a.attr(d, 'itemprop') === 'author' || AUTHOR_CLASS_RE.test(a.classes(d).join(' '));
    if (!match) continue;
    const len = normText(a.text(d)).length;
    if (len >= 2 && len <= 80) return d;
  }
  return null;
}

function consensusRule<N>(a: DomAdapter<N>, members: N[], pick: (m: N) => N | null, minRatio: number): string | null {
  const sample = members.slice(0, 20);
  const pairs = sample
    .map((item) => ({ item, target: pick(item) }))
    .filter((p): p is { item: N; target: N } => p.target !== null);
  if (!pairs.length || pairs.length < sample.length * minRatio) return null;
  const r = consensusSelector(a, pairs, members);
  return r && r.coverage >= minRatio ? r.selector : null;
}

export function inferFields<N>(a: DomAdapter<N>, members: N[]): FieldRules {
  const fields: FieldRules = {};
  const titles = new Map<N, N | null>();
  const titleOf = (m: N) => {
    if (!titles.has(m)) titles.set(m, pickTitle(a, m));
    return titles.get(m) ?? null;
  };
  const title = consensusRule(a, members, titleOf, 0.5);
  if (title) fields.title = { selector: title, attr: 'text' };
  const link = consensusRule(a, members, (m) => pickLink(a, m, titleOf(m)), 0.5);
  if (link) fields.link = { selector: link, attr: 'href' };
  const description = consensusRule(a, members, (m) => pickDescription(a, m, titleOf(m)), 0.4);
  if (description) fields.description = { selector: description, attr: 'text' };
  const date = consensusRule(a, members, (m) => pickDate(a, m), 0.4);
  if (date) fields.date = { selector: date };
  const image = consensusRule(a, members, (m) => pickImage(a, m), 0.4);
  if (image) fields.image = { selector: image, attr: 'src' };
  const author = consensusRule(a, members, (m) => pickAuthor(a, m), 0.4);
  if (author) fields.author = { selector: author, attr: 'text' };
  return fields;
}
