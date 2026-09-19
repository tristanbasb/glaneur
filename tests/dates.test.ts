import { describe, expect, it } from 'vitest';
import { parseDate } from '../src/server/core/dates.js';

const now = new Date('2026-09-15T12:00:00Z');

function parts(ts: number | null) {
  const d = new Date(ts ?? NaN);
  return [d.getFullYear(), d.getMonth() + 1, d.getDate()];
}

describe('parseDate', () => {
  it('reads machine formats', () => {
    expect(parseDate('2026-09-10T08:00:00+02:00', { now })).toBe(Date.parse('2026-09-10T06:00:00Z'));
    expect(parseDate('Thu, 10 Sep 2026 06:00:00 GMT', { now })).toBe(Date.parse('2026-09-10T06:00:00Z'));
    expect(parseDate('1789000000', { now })).toBe(1789000000 * 1000);
  });

  it('reads French relative dates', () => {
    const t = parseDate('il y a 3 heures', { now, lang: 'fr' });
    expect(Math.abs((t ?? 0) - (now.getTime() - 3 * 3600_000))).toBeLessThan(60_000);
    expect(parts(parseDate('hier', { now, lang: 'fr' }))).toEqual(parts(now.getTime() - 86_400_000));
  });

  it('reads French absolute dates, day first', () => {
    expect(parts(parseDate('12/03/2026', { now, lang: 'fr' }))).toEqual([2026, 3, 12]);
    const long = new Date(parseDate('Publié le 3 septembre 2026 à 14h30', { now, lang: 'fr' }) ?? NaN);
    expect([long.getMonth() + 1, long.getDate(), long.getHours(), long.getMinutes()]).toEqual([9, 3, 14, 30]);
  });

  it('reads English dates', () => {
    expect(parts(parseDate('Sep 3, 2026', { now, lang: 'en' }))).toEqual([2026, 9, 3]);
  });

  it('moves year-less dates in the future back one year', () => {
    expect(parts(parseDate('3 décembre', { now, lang: 'fr' }))[0]).toBe(2025);
  });

  it('rejects text without a date', () => {
    expect(parseDate('Lire la suite', { now })).toBeNull();
    expect(parseDate('', { now })).toBeNull();
  });
});
