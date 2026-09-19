const rtf = new Intl.RelativeTimeFormat('fr', { numeric: 'auto' });
const dateTime = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const shortDate = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' });
const numberFormat = new Intl.NumberFormat('fr-FR');

const STEPS: Array<[Intl.RelativeTimeFormatUnit, number, number]> = [
  ['minute', 60_000, 60],
  ['hour', 3_600_000, 24],
  ['day', 86_400_000, 7],
  ['week', 604_800_000, 4.35],
  ['month', 2_629_800_000, 12],
  ['year', 31_557_600_000, Infinity],
];

export function relativeTime(ts: number | null | undefined, now = Date.now()): string {
  if (!ts) return 'jamais';
  const diff = ts - now;
  const abs = Math.abs(diff);
  if (abs < 45_000) return diff <= 0 ? 'à l’instant' : 'dans un instant';
  for (const [unit, ms, max] of STEPS) {
    const value = abs / ms;
    if (value < max) return rtf.format(Math.round(diff / ms) || Math.sign(diff), unit);
  }
  return dateTime.format(ts);
}

export function formatDateTime(ts: number | null | undefined): string {
  return ts ? dateTime.format(ts) : '—';
}

export function formatShortDate(ts: number | null | undefined): string {
  if (!ts) return '—';
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  return shortDate.format(ts) + (d.getFullYear() !== now.getFullYear() ? ` ${d.getFullYear()}` : '');
}

export function formatNumber(n: number): string {
  return numberFormat.format(n);
}

export function plural(n: number, one: string, many: string): string {
  return `${formatNumber(n)} ${n > 1 ? many : one}`;
}

export function formatInterval(minutes: number): string {
  if (minutes < 60) return `toutes les ${minutes} min`;
  if (minutes === 60) return 'toutes les heures';
  if (minutes < 1440 && minutes % 60 === 0) return `toutes les ${minutes / 60} h`;
  if (minutes === 1440) return 'une fois par jour';
  if (minutes === 10080) return 'une fois par semaine';
  if (minutes % 1440 === 0) return `tous les ${minutes / 1440} jours`;
  return `toutes les ${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0).replace('.', ',')} s`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(0)} Ko`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1).replace('.', ',')} Mo`;
  return `${(bytes / 1024 ** 3).toFixed(2).replace('.', ',')} Go`;
}

export function domainOf(url: string | null | undefined): string {
  if (!url) return '';
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}
