import * as chrono from 'chrono-node';

const MIN_TS = Date.UTC(1995, 0, 1);

type Parser = { parse: (text: string, ref?: Date, option?: chrono.ParsingOption) => chrono.ParsedResult[] };

const PARSERS: Record<string, Parser> = {
  fr: chrono.fr,
  en: chrono.en,
  de: chrono.de,
  es: chrono.es,
  it: chrono.it,
  nl: chrono.nl,
  pt: chrono.pt,
};

function parserOrder(lang: string | null | undefined): Parser[] {
  const code = (lang ?? '').slice(0, 2).toLowerCase();
  const order: Parser[] = [];
  if (PARSERS[code]) order.push(PARSERS[code]);
  for (const key of ['fr', 'en']) if (!order.includes(PARSERS[key])) order.push(PARSERS[key]);
  return order;
}

/** Parses absolute, relative and localized dates. Returns a timestamp (ms) or null. */
export function parseDate(input: string | null | undefined, opts: { lang?: string | null; now?: Date } = {}): number | null {
  if (!input) return null;
  const text = input.replace(/\s+/g, ' ').trim().slice(0, 200);
  if (!text) return null;
  const now = opts.now ?? new Date();
  const maxTs = now.getTime() + 2 * 86_400_000;
  const inRange = (t: number) => (Number.isFinite(t) && t >= MIN_TS && t <= maxTs ? t : null);

  if (/^\d{10}(\.\d+)?$/.test(text)) return inRange(parseFloat(text) * 1000);
  if (/^\d{13}$/.test(text)) return inRange(parseInt(text, 10));
  if (/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?)?(Z|[+-]\d{2}:?\d{2})?$/.test(text)) {
    const t = Date.parse(text.replace(' ', 'T'));
    if (!Number.isNaN(t)) return inRange(t);
  }
  if (/^[A-Za-z]{3},? \d{1,2} [A-Za-z]{3} \d{2,4}/.test(text)) {
    const t = Date.parse(text);
    if (!Number.isNaN(t)) return inRange(t);
  }

  let best: chrono.ParsedResult | null = null;
  for (const parser of parserOrder(opts.lang)) {
    let results: chrono.ParsedResult[];
    try {
      results = parser.parse(text, now);
    } catch {
      continue;
    }
    for (const r of results) if (!best || r.text.length > best.text.length) best = r;
  }
  if (!best) {
    const t = Date.parse(text);
    return Number.isNaN(t) ? null : inRange(t);
  }
  let date = best.start.date();
  if (date.getTime() > maxTs && !best.start.isCertain('year')) {
    date = new Date(date);
    date.setFullYear(date.getFullYear() - 1);
  }
  return inRange(date.getTime());
}
