// Page watcher: turns changes of a page region into feed items.
import type { CheerioAPI } from 'cheerio';
import { diffLines } from 'diff';
import { sha1, truncate } from '../util.js';
import type { RawItem } from './extract-html.js';
import { cleanMultiline, escapeHtml, nodeText } from './html.js';

export interface WatchState {
  hash?: string;
  text?: string;
  checkedAt?: number;
  changedAt?: number;
}

export function watchSnapshot($: CheerioAPI, selector: string, ignore?: string): { text: string; matched: number } {
  const sel = selector.trim();
  let nodes;
  try {
    nodes = sel ? $(sel).toArray() : $('body').toArray();
  } catch {
    throw new Error(`Sélecteur de zone invalide : ${sel}`);
  }
  let text = cleanMultiline(nodes.map((n) => nodeText(n)).join('\n\n'));
  if (ignore?.trim()) {
    try {
      text = text.replace(new RegExp(ignore, 'gi'), '');
    } catch {
      // invalid ignore pattern: compare the raw text
    }
  }
  text = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join('\n');
  return { text: text.slice(0, 200_000), matched: nodes.length };
}

const ROW = 'margin:0;padding:3px 10px;font-family:ui-monospace,monospace;font-size:13px;white-space:pre-wrap';

function row(kind: 'add' | 'del' | 'ctx', line: string): string {
  if (kind === 'add') return `<p style="${ROW};background:#e3f6e8;border-left:3px solid #2f9e5b"><ins style="text-decoration:none">+ ${escapeHtml(line)}</ins></p>`;
  if (kind === 'del') return `<p style="${ROW};background:#fbe7e7;border-left:3px solid #c94343"><del>− ${escapeHtml(line)}</del></p>`;
  return `<p style="${ROW};color:#6b7079;border-left:3px solid transparent">  ${escapeHtml(line)}</p>`;
}

export function diffHtml(before: string, after: string): { html: string; added: number; removed: number } {
  const parts = diffLines(before, after);
  let added = 0;
  let removed = 0;
  const rows: string[] = [];
  parts.forEach((part, index) => {
    const lines = part.value.split('\n').filter((l) => l.trim());
    if (part.added) {
      added += lines.length;
      rows.push(...lines.map((l) => row('add', l)));
    } else if (part.removed) {
      removed += lines.length;
      rows.push(...lines.map((l) => row('del', l)));
    } else {
      const isFirst = index === 0;
      const isLast = index === parts.length - 1;
      const head = isFirst ? [] : lines.slice(0, 2);
      const tail = isLast ? [] : lines.slice(-2);
      if (lines.length <= 4 && !isFirst && !isLast) rows.push(...lines.map((l) => row('ctx', l)));
      else {
        rows.push(...head.map((l) => row('ctx', l)));
        if (lines.length > head.length + tail.length) rows.push(`<p style="${ROW};color:#9aa0a8">…</p>`);
        rows.push(...tail.map((l) => row('ctx', l)));
      }
    }
  });
  return { html: rows.join('\n'), added, removed };
}

function snapshotHtml(text: string): string {
  return `<pre style="white-space:pre-wrap;font-size:13px">${escapeHtml(truncate(text, 4000))}</pre>`;
}

export function runWatch(
  $: CheerioAPI,
  source: { selector: string; ignore?: string },
  state: WatchState,
  pageUrl: string,
  mode: 'run' | 'preview',
): { items: RawItem[]; state: WatchState } {
  const { text, matched } = watchSnapshot($, source.selector, source.ignore);
  if (!matched) throw new Error(`La zone surveillée « ${source.selector} » est introuvable dans la page.`);
  if (!text) throw new Error('La zone surveillée ne contient aucun texte.');
  const hash = sha1(text);
  const now = Date.now();
  const base = { link: pageUrl, image: null, author: null, found: {}, contentIsHtml: true };

  if (mode === 'preview') {
    return {
      items: [{ ...base, title: 'Contenu actuel de la zone surveillée', guid: `preview-${hash}`, content: snapshotHtml(text), date: now }],
      state,
    };
  }

  const items: RawItem[] = [];
  if (!state.hash) {
    items.push({ ...base, title: 'Surveillance démarrée', guid: `watch-init-${hash.slice(0, 16)}`, content: `<p>Glaneur vous préviendra dès que cette zone changera. Contenu actuel :</p>${snapshotHtml(text)}`, date: now });
  } else if (state.hash !== hash) {
    const diff = diffHtml(state.text ?? '', text);
    const label = [diff.added ? `+${diff.added}` : '', diff.removed ? `−${diff.removed}` : ''].filter(Boolean).join(' / ') || 'modifiée';
    items.push({ ...base, title: `Changement détecté (${label} ligne${diff.added + diff.removed > 1 ? 's' : ''})`, guid: `watch-${hash.slice(0, 16)}-${now}`, content: diff.html, date: now });
  }
  return {
    items,
    state: { hash, text: text.slice(0, 100_000), checkedAt: now, changedAt: items.length ? now : state.changedAt },
  };
}
