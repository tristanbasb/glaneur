import type { CheerioAPI } from 'cheerio';
import type { Element } from 'domhandler';
import type { DomAdapter } from '../../shared/selectors.js';
import { isElement, nodeText } from './html.js';

/** Exposes a cheerio document through the DomAdapter used by the shared selector logic. */
export function cheerioAdapter($: CheerioAPI): DomAdapter<Element> {
  return {
    tag: (n) => n.name.toLowerCase(),
    classes: (n) => (n.attribs?.class ?? '').split(/\s+/).filter(Boolean),
    attr: (n, name) => n.attribs?.[name] ?? null,
    parent: (n) => {
      const p = n.parent;
      return p && isElement(p) ? p : null;
    },
    children: (n) => n.children.filter(isElement),
    queryAll: (scope, selector) => (scope ? $(scope).find(selector) : $(selector)).toArray().filter(isElement),
    text: (n) => nodeText(n),
  };
}
