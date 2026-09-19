// Visual selector engine: runs in the app, works directly on the sandboxed page document.
import { isUsableClass } from '../../shared/css';
import { findListGroups } from '../../shared/detect';
import { consensusSelector, type DomAdapter, groupSelector, normText, safeQuery, signature, uniqueSelector } from '../../shared/selectors';
import type { FieldKey, FieldRule, FieldRules } from '../../shared/types';
import { FIELD_META, FIELD_ORDER, type PickMode, TOOL_META } from '../lib/fields';

export type EngineMode = PickMode | 'region' | 'click' | 'hide' | null;

export interface EngineState {
  mode: EngineMode;
  itemSelector: string;
  fields: FieldRules;
  region: string;
  /** Elements put out of the way in the view (a popup, say): the feed does not depend on them. */
  hidden: string[];
}

export type PickResult =
  | { kind: 'item'; itemSelector: string; count: number }
  | { kind: 'field'; field: FieldKey; rule: FieldRule; itemSelector?: string }
  | { kind: 'region'; selector: string }
  | { kind: 'click'; selector: string; text: string }
  | { kind: 'hide'; selector: string }
  | { kind: 'error'; message: string };

export interface EngineStats {
  items: number;
  fields: Partial<Record<FieldKey, number>>;
  region: number;
}

interface Callbacks {
  onPick: (result: PickResult) => void;
  onStats: (stats: EngineStats) => void;
  onEscape: () => void;
}

const SILENT = new Set(['script', 'style', 'noscript', 'template', 'svg']);

/** What a visitor would click on: the button or link around the pointer. */
const ACTIONABLE = 'button, a[href], [role="button"], input[type="submit"], input[type="button"], label, summary';

export function visibleText(node: Node): string {
  let out = '';
  node.childNodes.forEach((child) => {
    if (child.nodeType === 3) out += child.nodeValue ?? '';
    else if (child.nodeType === 1 && !SILENT.has((child as Element).tagName.toLowerCase())) out += visibleText(child);
  });
  return out;
}

export function createAdapter(doc: Document): DomAdapter<Element> {
  return {
    tag: (n) => n.tagName.toLowerCase(),
    classes: (n) => Array.from(n.classList),
    attr: (n, name) => n.getAttribute(name),
    parent: (n) => n.parentElement,
    children: (n) => Array.from(n.children),
    queryAll: (scope, selector) => Array.from((scope ?? doc).querySelectorAll(selector)),
    text: (n) => visibleText(n),
  };
}

function elementFrom(target: EventTarget | null): Element | null {
  let node = target as Node | null;
  while (node && node.nodeType !== 1) node = node.parentNode;
  return node as Element | null;
}

function restoreStyle(el: Element, style: string | null): void {
  if (style === null) el.removeAttribute('style');
  else el.setAttribute('style', style);
}

function modeLabel(mode: Exclude<EngineMode, null>): string {
  if (mode === 'region') return 'Zone';
  if (mode === 'click' || mode === 'hide') return TOOL_META[mode].label;
  return FIELD_META[mode].label;
}

function modeColor(mode: Exclude<EngineMode, null>): string {
  if (mode === 'click' || mode === 'hide') return TOOL_META[mode].hex;
  return mode === 'region' || mode === 'item' ? '#ffe14a' : FIELD_META[mode].hex;
}

// --z is the zoom applied to the page: strokes and labels are divided by it to keep their on-screen size.
const OVERLAY_CSS = `
:host { all: initial; --z: 1; }
.box { position: absolute; box-sizing: border-box; pointer-events: none; }
.item { outline: calc(2px / var(--z)) dashed rgba(27, 30, 36, 0.72); outline-offset: calc(2px / var(--z)); border-radius: 6px; }
.item-n { position: absolute; top: -11px; left: -11px; min-width: 20px; height: 20px; padding: 0 5px; box-sizing: border-box;
  border-radius: 10px; background: #1b1e24; color: #ffe14a; font: 700 11px/20px system-ui, sans-serif; text-align: center;
  transform: scale(calc(1 / var(--z))); }
.mark { border-radius: 3px; mix-blend-mode: multiply; opacity: 0.62; }
.mark-link { mix-blend-mode: normal; opacity: 1; border: calc(2.5px / var(--z)) solid #2f8fd8; border-radius: 5px; }
.region { outline: calc(3px / var(--z)) solid #1b1e24; outline-offset: calc(2px / var(--z)); background: rgba(255, 225, 74, 0.28); border-radius: 4px; }
.hover { position: absolute; box-sizing: border-box; pointer-events: none; border: calc(2px / var(--z)) solid #1b1e24; border-radius: 5px; }
.hover-label { position: absolute; pointer-events: none; max-width: 460px; overflow: hidden; padding: 3px 8px; border-radius: 6px;
  background: #1b1e24; color: #f5f6f2; font: 600 11.5px/1.35 ui-monospace, SFMono-Regular, Menlo, monospace; white-space: nowrap; text-overflow: ellipsis;
  transform: scale(calc(1 / var(--z))); }
.hover-label b { color: #ffe14a; font-weight: 700; }
[hidden] { display: none !important; }
`;

export class PickerEngine {
  readonly adapter: DomAdapter<Element>;
  private host: HTMLElement;
  private layer: HTMLElement;
  private hover: HTMLElement;
  private hoverLabel: HTMLElement;
  private pageStyle: HTMLStyleElement;
  private state: EngineState = { mode: null, itemSelector: '', fields: {}, region: '', hidden: [] };
  private groups: Array<{ members: Element[]; score: number }> | null = null;
  private lastTarget: Element | null = null;
  private frame = 0;
  private interval: number;
  private layoutKey = '';
  private statsKey = '';
  private zoom = 1;
  /** Hidden elements and scroll-locked roots, with their original style attribute. */
  private hiddenEls = new Map<HTMLElement, string | null>();
  private unlocked = new Map<HTMLElement, string | null>();
  private cleanup: Array<() => void> = [];

  constructor(
    private readonly doc: Document,
    private readonly callbacks: Callbacks,
  ) {
    this.adapter = createAdapter(doc);
    this.host = doc.createElement('glaneur-overlay');
    this.host.setAttribute('style', 'position:absolute;top:0;left:0;width:0;height:0;overflow:visible;pointer-events:none;');
    const shadow = this.host.attachShadow({ mode: 'open' });
    const style = doc.createElement('style');
    style.textContent = OVERLAY_CSS;
    shadow.appendChild(style);
    this.layer = this.make('div', 'layer');
    this.hover = this.make('div', 'hover');
    this.hoverLabel = this.make('div', 'hover-label');
    this.hover.hidden = true;
    this.hoverLabel.hidden = true;
    shadow.append(this.layer, this.hover, this.hoverLabel);
    doc.documentElement.appendChild(this.host);

    this.pageStyle = doc.createElement('style');
    this.pageStyle.textContent = 'html.glaneur-picking, html.glaneur-picking * { cursor: crosshair !important; }';
    (doc.head ?? doc.documentElement).appendChild(this.pageStyle);

    const listen = (target: EventTarget, type: string, handler: (e: Event) => void, capture = true) => {
      target.addEventListener(type, handler, capture);
      this.cleanup.push(() => target.removeEventListener(type, handler, capture));
    };
    const block = (e: Event) => e.preventDefault();
    listen(doc, 'mouseover', (e) => this.handleOver(e as MouseEvent));
    listen(doc, 'mouseout', (e) => {
      if (!(e as MouseEvent).relatedTarget) this.hideHover();
    });
    listen(doc, 'click', (e) => this.handleClick(e as MouseEvent));
    listen(doc, 'auxclick', block);
    listen(doc, 'submit', block);
    listen(doc, 'dragstart', block);
    listen(doc, 'keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Escape') this.callbacks.onEscape();
    });
    listen(doc, 'scroll', () => this.schedule());
    listen(doc, 'load', () => this.schedule());
    const win = doc.defaultView;
    if (win) listen(win, 'resize', () => this.schedule(), false);
    this.interval = window.setInterval(() => this.checkLayout(), 1200);
  }

  destroy(): void {
    for (const fn of this.cleanup) fn();
    this.cleanup = [];
    window.clearInterval(this.interval);
    cancelAnimationFrame(this.frame);
    this.host.remove();
    this.pageStyle.remove();
    this.doc.documentElement?.classList.remove('glaneur-picking');
  }

  update(next: Partial<EngineState>): void {
    this.state = { ...this.state, ...next };
    this.doc.documentElement.classList.toggle('glaneur-picking', !!this.state.mode);
    if (!this.state.mode) this.hideHover();
    this.applyHidden();
    this.redraw();
  }

  count(selector: string): number {
    return selector.trim() ? safeQuery(this.adapter, null, selector).length : 0;
  }

  // ---- Drawing -----------------------------------------------------------------------------------

  private make(tag: string, className: string): HTMLElement {
    const el = this.doc.createElement(tag);
    el.className = className;
    return el;
  }

  private schedule(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.redraw();
    });
  }

  private checkLayout(): void {
    const root = this.doc.documentElement;
    if (!root?.isConnected) return;
    const key = `${root.scrollWidth}x${root.scrollHeight}`;
    if (key !== this.layoutKey) {
      this.layoutKey = key;
      this.schedule();
    }
  }

  private firstIn(item: Element, selector: string): Element | null {
    if (selector === ':scope') return item;
    try {
      return item.querySelector(selector);
    } catch {
      return null;
    }
  }

  private box(el: Element, className: string): HTMLElement | null {
    const win = this.doc.defaultView;
    const r = el.getBoundingClientRect();
    if (!win || (r.width === 0 && r.height === 0)) return null;
    const b = this.make('div', `box ${className}`);
    b.style.left = `${r.left + win.scrollX}px`;
    b.style.top = `${r.top + win.scrollY}px`;
    b.style.width = `${r.width}px`;
    b.style.height = `${r.height}px`;
    return b;
  }

  redraw(): void {
    if (!this.doc.documentElement?.isConnected) return;
    const { itemSelector, fields, region, mode } = this.state;
    const frag = this.doc.createDocumentFragment();
    const stats: EngineStats = { items: 0, fields: {}, region: 0 };

    if (mode === 'region' || (region && !itemSelector)) {
      const nodes = region ? safeQuery(this.adapter, null, region) : [];
      stats.region = nodes.length;
      for (const n of nodes.slice(0, 30)) {
        const b = this.box(n, 'region');
        if (b) frag.appendChild(b);
      }
    } else if (itemSelector.trim()) {
      const items = safeQuery(this.adapter, null, itemSelector);
      stats.items = items.length;
      items.forEach((item, i) => {
        const draw = i < 250;
        if (draw) {
          const b = this.box(item, 'item');
          if (b) {
            if (i < 99) {
              const n = this.make('span', 'item-n');
              n.textContent = String(i + 1);
              b.appendChild(n);
            }
            frag.appendChild(b);
          }
        }
        for (const key of FIELD_ORDER) {
          const rule = fields[key];
          if (!rule?.selector?.trim()) continue;
          const target = this.firstIn(item, rule.selector.trim());
          if (!target) continue;
          stats.fields[key] = (stats.fields[key] ?? 0) + 1;
          if (!draw) continue;
          // Links usually wrap other fields: outline them so the marker colours do not mix.
          const mark = this.box(target, key === 'link' ? 'mark mark-link' : 'mark');
          if (mark) {
            if (key !== 'link') mark.style.background = FIELD_META[key].hex;
            frag.appendChild(mark);
          }
        }
      });
    }

    this.layer.replaceChildren(frag);
    const key = JSON.stringify(stats);
    if (key !== this.statsKey) {
      this.statsKey = key;
      this.callbacks.onStats(stats);
    }
  }

  /** Hides the elements put out of the way, and gives back the scrolling that a hidden popup had locked. */
  private applyHidden(): void {
    const wanted = new Set<HTMLElement>();
    for (const selector of this.state.hidden) {
      for (const el of safeQuery(this.adapter, null, selector)) wanted.add(el as HTMLElement);
    }
    for (const [el, style] of this.hiddenEls) {
      if (wanted.has(el)) continue;
      restoreStyle(el, style);
      this.hiddenEls.delete(el);
    }
    for (const el of wanted) {
      if (this.hiddenEls.has(el)) continue;
      this.hiddenEls.set(el, el.getAttribute('style'));
      el.style.setProperty('display', 'none', 'important');
      this.hideHover();
    }
    const view = this.doc.defaultView;
    for (const root of [this.doc.documentElement, this.doc.body]) {
      if (!root || !view) continue;
      if (this.hiddenEls.size && !this.unlocked.has(root) && view.getComputedStyle(root).overflowY === 'hidden') {
        this.unlocked.set(root, root.getAttribute('style'));
        root.style.setProperty('overflow', 'auto', 'important');
      } else if (!this.hiddenEls.size && this.unlocked.has(root)) {
        restoreStyle(root, this.unlocked.get(root) ?? null);
        this.unlocked.delete(root);
      }
    }
    this.schedule();
  }

  /** Zoom applied to the page on screen: overlay strokes and labels compensate for it. */
  setZoom(zoom: number): void {
    this.zoom = zoom > 0 ? zoom : 1;
    this.host.style.setProperty('--z', String(this.zoom));
  }

  private hideHover(): void {
    this.hover.hidden = true;
    this.hoverLabel.hidden = true;
  }

  private handleOver(e: MouseEvent): void {
    const mode = this.state.mode;
    const raw = elementFrom(e.target);
    if (!mode || !raw || raw === this.doc.documentElement || raw === this.doc.body || raw.tagName === 'GLANEUR-OVERLAY') {
      this.hideHover();
      return;
    }
    const el = this.targetFor(mode, raw);
    const win = this.doc.defaultView;
    if (!win) return;
    const r = el.getBoundingClientRect();
    const z = this.zoom;
    const pad = 3 / z;
    Object.assign(this.hover.style, {
      left: `${r.left + win.scrollX - pad}px`,
      top: `${r.top + win.scrollY - pad}px`,
      width: `${r.width + pad * 2}px`,
      height: `${r.height + pad * 2}px`,
      boxShadow: `0 0 0 ${4 / z}px ${modeColor(mode)}`,
    });
    this.hoverLabel.replaceChildren();
    const strong = this.doc.createElement('b');
    strong.textContent = modeLabel(mode);
    this.hoverLabel.append(strong, ` ${signature(this.adapter, el)}`);
    // The label keeps its on-screen size (scaled by 1/z), so it hangs from its bottom edge when placed above.
    const gap = 8 / z;
    const above = r.top - gap - 22 / z >= 2;
    this.hoverLabel.style.left = `${Math.max(4, r.left + win.scrollX - pad)}px`;
    this.hoverLabel.style.top = `${above ? r.top + win.scrollY - gap - 22 : r.bottom + win.scrollY + gap}px`;
    this.hoverLabel.style.transformOrigin = above ? 'left bottom' : 'left top';
    this.hover.hidden = false;
    this.hoverLabel.hidden = false;
  }

  private handleClick(e: MouseEvent): void {
    e.preventDefault();
    e.stopPropagation();
    const mode = this.state.mode;
    const target = elementFrom(e.target);
    if (!mode || !target || target.tagName === 'GLANEUR-OVERLAY') return;
    this.lastTarget = target;
    this.callbacks.onPick(this.pick(mode, target));
  }

  // ---- Selection logic ---------------------------------------------------------------------------

  /** What a click acts on in each mode: the repeated block, a field's element, a button, or a whole popup. */
  private targetFor(mode: Exclude<EngineMode, null>, raw: Element): Element {
    switch (mode) {
      case 'item':
        return this.groupFor(raw)?.find((m) => m === raw || m.contains(raw)) ?? raw;
      case 'region':
        return raw;
      case 'click':
        return raw.closest(ACTIONABLE) ?? raw;
      case 'hide':
        return this.overlayRoot(raw);
      default:
        return this.snap(mode, raw, this.doc.body);
    }
  }

  /** The popup around an element: its outermost fixed or sticky ancestor, else the element itself. */
  private overlayRoot(el: Element): Element {
    const view = this.doc.defaultView;
    let root = el;
    for (let cur: Element | null = el; cur && cur !== this.doc.body && cur !== this.doc.documentElement; cur = cur.parentElement) {
      const position = view?.getComputedStyle(cur).position;
      if (position === 'fixed' || position === 'sticky') root = cur;
    }
    return root;
  }

  /** The repeated group (list of similar blocks) that contains `target`. */
  groupFor(target: Element): Element[] | null {
    if (!this.groups) this.groups = this.doc.body ? findListGroups(this.adapter, this.doc.body, 30) : [];
    const containing = this.groups.find((g) => g.members.some((m) => m === target || m.contains(target)));
    if (containing) return containing.members;
    for (let el: Element | null = target; el && el !== this.doc.body; el = el.parentElement) {
      const parent: Element | null = el.parentElement;
      if (!parent) break;
      const classes = Array.from(el.classList).filter(isUsableClass);
      const tag = el.tagName;
      const siblings = Array.from(parent.children).filter((c) => c.tagName === tag && (!classes.length || classes.some((k) => c.classList.contains(k))));
      if (siblings.length >= 2) return siblings;
    }
    return null;
  }

  private snap(mode: FieldKey, target: Element, item: Element): Element {
    const inside = (el: Element | null) => (el && (el === item || item.contains(el)) ? el : null);
    switch (mode) {
      case 'link':
        return inside(target.closest('a[href]')) ?? target.querySelector('a[href]') ?? target;
      case 'image': {
        if (target.tagName === 'IMG') return target;
        const img = target.querySelector('img') ?? inside(target.closest('picture'))?.querySelector('img');
        if (img) return img;
        for (let el: Element | null = target; el && el !== item.parentElement; el = el.parentElement) {
          if (/url\(/i.test(el.getAttribute('style') ?? '')) return el;
        }
        return target;
      }
      case 'date':
        return inside(target.closest('time')) ?? target.querySelector('time') ?? target;
      default: {
        let el = target;
        const text = normText(visibleText(el));
        while (el.parentElement && el.parentElement !== item && el.parentElement !== this.doc.body && normText(visibleText(el.parentElement)) === text) {
          el = el.parentElement;
        }
        return el;
      }
    }
  }

  private defaultAttr(mode: FieldKey, el: Element): string {
    switch (mode) {
      case 'link':
        return 'href';
      case 'image':
        return 'src';
      case 'date':
        return el.hasAttribute('datetime') ? 'datetime' : '';
      case 'description':
        return 'html';
      default:
        return 'text';
    }
  }

  pick(mode: Exclude<EngineMode, null>, target: Element): PickResult {
    const a = this.adapter;
    if (mode === 'region') return { kind: 'region', selector: uniqueSelector(a, target) };
    if (mode === 'hide') return { kind: 'hide', selector: uniqueSelector(a, this.overlayRoot(target)) };
    if (mode === 'click') {
      const el = target.closest(ACTIONABLE) ?? target;
      const text = normText(visibleText(el)) || el.getAttribute('aria-label') || el.getAttribute('value') || '';
      return { kind: 'click', selector: uniqueSelector(a, el), text: text.slice(0, 120) };
    }

    if (mode === 'item') {
      const members = this.groupFor(target);
      if (!members) return { kind: 'error', message: 'Aucun bloc répété autour de cet élément : cliquez à l’intérieur d’un article de la liste.' };
      return { kind: 'item', itemSelector: groupSelector(a, members), count: members.length };
    }

    let itemSelector = this.state.itemSelector.trim();
    let items = itemSelector ? safeQuery(a, null, itemSelector) : [];
    let item = items.find((it) => it === target || it.contains(target)) ?? null;
    let changedItem = false;
    if (!item) {
      const members = this.groupFor(target);
      if (!members) return { kind: 'error', message: 'Cet élément ne fait pas partie d’une liste répétée. Choisissez d’abord l’élément qui se répète.' };
      itemSelector = groupSelector(a, members);
      items = safeQuery(a, null, itemSelector);
      item = items.find((it) => it === target || it.contains(target)) ?? null;
      changedItem = true;
      if (!item) return { kind: 'error', message: 'Impossible de relier cet élément à la liste.' };
    }
    const el = this.snap(mode, target, item);
    const best = consensusSelector(a, [{ item, target: el }], items);
    if (!best) return { kind: 'error', message: 'Impossible de décrire cet élément avec un sélecteur.' };
    return {
      kind: 'field',
      field: mode,
      rule: { selector: best.selector, attr: this.defaultAttr(mode, el) },
      itemSelector: changedItem ? itemSelector : undefined,
    };
  }

  /** Recomputes field selectors after the item selector changed, keeping the same targets. */
  rebase(oldSelector: string, newSelector: string, fields: FieldRules): FieldRules {
    const a = this.adapter;
    const oldItems = safeQuery(a, null, oldSelector).slice(0, 25);
    const newItems = safeQuery(a, null, newSelector);
    if (!oldItems.length || !newItems.length) return fields;
    const out: FieldRules = {};
    for (const key of FIELD_ORDER) {
      const rule = fields[key];
      if (!rule) continue;
      const pairs: Array<{ item: Element; target: Element }> = [];
      for (const old of oldItems) {
        const target = this.firstIn(old, rule.selector);
        const item = target && newItems.find((n) => n === target || n.contains(target));
        if (target && item) pairs.push({ item, target });
      }
      const best = pairs.length ? consensusSelector(a, pairs, newItems) : null;
      out[key] = best ? { ...rule, selector: best.selector } : rule;
    }
    return out;
  }

  /** Item selector one level up (each block's own parent). */
  widen(): PickResult {
    const a = this.adapter;
    const items = safeQuery(a, null, this.state.itemSelector);
    const parents = [...new Set(items.map((i) => i.parentElement).filter((p): p is HTMLElement => !!p && p !== this.doc.body && p !== this.doc.documentElement))];
    if (items.length < 2 || parents.length < Math.max(2, items.length * 0.8)) {
      return { kind: 'error', message: 'Impossible d’élargir : les éléments partagent déjà le même conteneur.' };
    }
    return { kind: 'item', itemSelector: groupSelector(a, parents), count: parents.length };
  }

  /** Item selector one level down, towards the last clicked element. */
  narrow(): PickResult {
    const a = this.adapter;
    const items = safeQuery(a, null, this.state.itemSelector);
    if (!items.length) return { kind: 'error', message: 'Aucun élément à resserrer.' };
    const last = this.lastTarget;
    const ref = items.find((i) => last && i.contains(last)) ?? items[0];
    const child = last && ref.contains(last) && last !== ref ? Array.from(ref.children).find((c) => c.contains(last)) : ref.firstElementChild;
    if (!child) return { kind: 'error', message: 'Ces éléments n’ont pas de bloc intérieur commun.' };
    const sig = signature(a, child);
    const kids = items.map((it) => Array.from(it.children).find((c) => signature(a, c) === sig)).filter((c): c is Element => !!c);
    if (kids.length < 2) return { kind: 'error', message: 'Ces éléments n’ont pas de bloc intérieur commun.' };
    return { kind: 'item', itemSelector: groupSelector(a, kids), count: kids.length };
  }

  /** Watched zone one level up: the block that contains the current zone. */
  widenRegion(): PickResult {
    const a = this.adapter;
    const current = this.state.region.trim() ? (safeQuery(a, null, this.state.region)[0] ?? null) : null;
    const parent = current?.parentElement;
    if (!current || !parent || parent === this.doc.body || parent === this.doc.documentElement) {
      return { kind: 'error', message: 'Impossible d’élargir davantage cette zone.' };
    }
    return { kind: 'region', selector: uniqueSelector(a, parent) };
  }
}
