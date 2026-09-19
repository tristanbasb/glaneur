import type { AppSettings } from '../shared/types.js';
import { get, run } from './db.js';
import { randomToken } from './util.js';

export const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

const DEFAULTS: Omit<AppSettings, 'feedKey'> = {
  feedKeyRequired: true,
  publicUrl: '',
  defaultRefreshMinutes: 60,
  userAgent: DEFAULT_USER_AGENT,
  acceptLanguage: 'fr-FR,fr;q=0.9,en-US;q=0.7,en;q=0.6',
  rsshubBase: 'https://rsshub.app',
};

export function readSetting<T>(key: string): T | undefined {
  const row = get<{ value: string }>('SELECT value FROM settings WHERE key = ?', key);
  if (!row) return undefined;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return undefined;
  }
}

export function writeSetting(key: string, value: unknown): void {
  run(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    key,
    JSON.stringify(value),
  );
}

let cache: AppSettings | null = null;

export function getSettings(): AppSettings {
  if (cache) return cache;
  let feedKey = readSetting<string>('feedKey');
  if (!feedKey) {
    feedKey = randomToken(18);
    writeSetting('feedKey', feedKey);
  }
  const stored = readSetting<Partial<AppSettings>>('app') ?? {};
  cache = { ...DEFAULTS, ...stored, feedKey };
  return cache;
}

function cleanUrl(value: unknown): string {
  const s = String(value ?? '').trim().replace(/\/+$/, '');
  if (!s) return '';
  return /^https?:\/\//i.test(s) ? s : '';
}

export function updateSettings(patch: Partial<AppSettings>): AppSettings {
  const current = getSettings();
  const next: AppSettings = { ...current };
  if (typeof patch.feedKeyRequired === 'boolean') next.feedKeyRequired = patch.feedKeyRequired;
  if (patch.publicUrl !== undefined) next.publicUrl = cleanUrl(patch.publicUrl);
  if (patch.defaultRefreshMinutes !== undefined) {
    const n = Math.round(Number(patch.defaultRefreshMinutes));
    if (Number.isFinite(n)) next.defaultRefreshMinutes = Math.min(10080, Math.max(5, n));
  }
  if (typeof patch.userAgent === 'string') next.userAgent = patch.userAgent.trim() || DEFAULT_USER_AGENT;
  if (typeof patch.acceptLanguage === 'string') next.acceptLanguage = patch.acceptLanguage.trim() || DEFAULTS.acceptLanguage;
  if (patch.rsshubBase !== undefined) next.rsshubBase = cleanUrl(patch.rsshubBase) || DEFAULTS.rsshubBase;
  const { feedKey: _omit, ...persisted } = next;
  writeSetting('app', persisted);
  cache = next;
  return next;
}

export function rotateFeedKey(): string {
  const key = randomToken(18);
  writeSetting('feedKey', key);
  cache = null;
  return key;
}
