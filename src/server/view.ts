// Prepares a fetched page for the visual selector: no scripts, same DOM structure, absolute assets.
import * as cheerio from 'cheerio';
import type { Element } from 'domhandler';
import { CONSENT_BANNERS, SCROLL_LOCK_CLASS } from './core/consent.js';
import { escapeHtml } from './core/html.js';

/** Served with the page: nothing from the site can run, but its CSS and images still load. */
export const VIEW_CSP = [
  "default-src 'none'",
  'img-src * data: blob:',
  "style-src * 'unsafe-inline'",
  'font-src * data:',
  'media-src * data: blob:',
  "script-src 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "form-action 'none'",
  "connect-src 'none'",
].join('; ');

const LAZY_ATTRS = ['data-src', 'data-lazy-src', 'data-original', 'data-lazy', 'data-url'];
const DROPPED_LINKS = /(^|\s)(preload|modulepreload|prefetch|preconnect|dns-prefetch|manifest|serviceworker)(\s|$)/i;

export function prepareViewHtml(html: string, pageUrl: string): string {
  const $ = cheerio.load(html);
  $('base, meta[http-equiv], meta[charset]').remove();

  // Stylesheets that sites load through JavaScript tricks must be made plain, or the page shows unstyled.
  $('noscript').each((_, node) => {
    const raw = $(node).text();
    if (!/<(link|style)[\s>]/i.test(raw)) return;
    const fragment = cheerio.load(raw, null, false);
    fragment('link[rel~="stylesheet"], style').each((__, sheet) => {
      $('head').append(fragment.html(sheet));
    });
  });
  $('link').each((_, node) => {
    const el = node as Element;
    const rel = el.attribs.rel ?? '';
    if (/(^|\s)preload(\s|$)/i.test(rel) && (el.attribs.as ?? '').toLowerCase() === 'style') {
      el.attribs.rel = 'stylesheet';
      delete el.attribs.as;
    } else if (DROPPED_LINKS.test(rel)) {
      $(el).remove();
      return;
    }
    if (/(^|\s)stylesheet(\s|$)/i.test(el.attribs.rel ?? '') && el.attribs.media === 'print' && el.attribs.onload) {
      el.attribs.media = 'all';
    }
  });

  // Keep script elements in place (selectors stay valid) but make them inert.
  $('script').each((_, node) => {
    (node as Element).attribs = { type: 'text/x-glaneur-inert' };
  });
  // With scripting disabled the browser would render <noscript> content that the server never sees.
  $('noscript').remove();
  $('iframe, frame, embed, object').each((_, node) => {
    const el = node as Element;
    delete el.attribs.src;
    delete el.attribs.srcdoc;
    delete el.attribs.data;
  });
  $('video, audio').removeAttr('autoplay');

  // Consent banners cover the page and their buttons cannot work here. Hide them rather than remove them so that
  // selectors keep matching the real page, and release the scroll lock they set.
  const banners = $(CONSENT_BANNERS.join(', '));
  if (banners.length) {
    banners.each((_, node) => {
      const a = (node as Element).attribs;
      a.style = [a.style, 'display: none !important'].filter(Boolean).join('; ');
    });
    $('html, body').each((_, node) => {
      const a = (node as Element).attribs;
      const classes = (a.class ?? '').split(/\s+/).filter((c) => c && !SCROLL_LOCK_CLASS.test(c)).join(' ');
      if (classes) a.class = classes;
      else delete a.class;
      const style = (a.style ?? '').replace(/overflow(-[xy])?\s*:\s*hidden\s*(!\s*important)?\s*;?/gi, '').trim();
      if (style) a.style = style;
      else delete a.style;
    });
  }

  $('*').each((_, node) => {
    const el = node as Element;
    for (const name of Object.keys(el.attribs)) {
      if (/^on/i.test(name)) delete el.attribs[name];
      // CORS-mode requests (integrity/crossorigin) fail from our origin: load assets the plain way.
      else if (name === 'integrity' || name === 'crossorigin') delete el.attribs[name];
      else if (/^(href|src|action|formaction|xlink:href)$/i.test(name) && /^\s*javascript:/i.test(el.attribs[name])) el.attribs[name] = '#';
    }
  });

  $('img').each((_, node) => {
    const a = (node as Element).attribs;
    const lazy = LAZY_ATTRS.map((n) => a[n]).find((v) => v && !v.startsWith('data:'));
    if (lazy && (!a.src || a.src.startsWith('data:'))) a.src = lazy;
    if (!a.srcset && a['data-srcset']) a.srcset = a['data-srcset'];
  });

  $('head').prepend(`<meta charset="utf-8"><base href="${escapeHtml(pageUrl)}"><meta name="referrer" content="no-referrer">`);
  return $.html();
}
