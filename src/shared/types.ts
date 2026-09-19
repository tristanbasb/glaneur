// Domain types shared by the server and the web app.

export const FIELD_KEYS = ['title', 'link', 'description', 'date', 'image', 'author'] as const;
export type FieldKey = (typeof FIELD_KEYS)[number];

/**
 * How to read one field inside an item.
 * selector: CSS selector relative to the item (':scope' = the item itself, '' = automatic).
 * attr: 'text' | 'html' | any attribute name ('href', 'src', 'datetime'…). Empty = default for the field.
 * regex: optional pattern; the first capture group (or the whole match) is kept.
 */
export interface FieldRule {
  selector: string;
  attr?: string;
  regex?: string;
}

export type FieldRules = Partial<Record<FieldKey, FieldRule>>;

export interface RequestOptions {
  userAgent?: string;
  cookies?: string;
  headers?: Record<string, string>;
  timeoutSec?: number;
}

/** Width of the browser window pages are rendered in: the visual selector lays pages out at this width too. */
export const PAGE_WIDTH = 1366;

export interface RenderOptions {
  enabled: boolean;
  waitFor?: string;
  scroll?: boolean;
  delayMs?: number;
}

export interface HtmlSource {
  type: 'html';
  url: string;
  render: RenderOptions;
  itemSelector: string;
  fields: FieldRules;
}

export type JsonFields = Partial<Record<FieldKey, string>>;

export interface JsonSource {
  type: 'json';
  url: string;
  method: 'GET' | 'POST';
  body?: string;
  /** Read the JSON from a <script> element of an HTML page (e.g. script#__NEXT_DATA__). */
  embedSelector?: string;
  itemsPath: string;
  /** Path relative to each item ("data.title"), or a template ("https://site/{{slug}}"). */
  fields: JsonFields;
}

export interface FeedSource {
  type: 'feed';
  urls: string[];
}

export interface WatchSource {
  type: 'watch';
  url: string;
  render: RenderOptions;
  /** Region to watch; empty = whole page. */
  selector: string;
  /** Regex of text to ignore when comparing (counters, timestamps…). */
  ignore?: string;
}

export type SourceConfig = HtmlSource | JsonSource | FeedSource | WatchSource;
export type SourceType = SourceConfig['type'];

export type FilterField = 'any' | 'title' | 'content' | 'link' | 'author';

export interface FilterRule {
  mode: 'include' | 'exclude';
  field: FilterField;
  pattern: string;
  regex?: boolean;
}

export interface FeedOptions {
  refreshMinutes: number;
  maxItems: number;
  filters: FilterRule[];
  fullText: { enabled: boolean; selector?: string };
  request: RequestOptions;
}

export interface FeedInput {
  name: string;
  slug?: string;
  description?: string;
  siteUrl?: string;
  iconUrl?: string;
  enabled: boolean;
  recipe?: string | null;
  source: SourceConfig;
  options: FeedOptions;
}

export interface FetchHistoryEntry {
  at: number;
  ok: boolean;
  found: number;
  added: number;
  ms: number;
  error?: string | null;
  trigger?: string;
}

export interface FeedSummary {
  id: string;
  slug: string;
  name: string;
  description: string;
  siteUrl: string;
  iconUrl: string;
  enabled: boolean;
  recipe: string | null;
  sourceType: SourceType;
  sourceUrl: string;
  refreshMinutes: number;
  createdAt: number;
  updatedAt: number;
  lastFetchAt: number | null;
  lastSuccessAt: number | null;
  nextFetchAt: number | null;
  lastError: string | null;
  errorCount: number;
  itemCount: number;
  lastItemAt: number | null;
  running: boolean;
  history: FetchHistoryEntry[];
  urls: FeedUrls;
}

export interface FeedUrls {
  rss: string;
  atom: string;
  json: string;
}

export interface FeedDetail extends FeedSummary {
  source: SourceConfig;
  options: FeedOptions;
}

/** A normalized item, as produced by extraction and shown in previews. */
export interface ItemData {
  guid: string;
  title: string;
  link: string | null;
  content: string | null;
  summary: string | null;
  image: string | null;
  author: string | null;
  date: number | null;
  /** Which fields came from the page (for field highlighting in the preview). */
  found?: Partial<Record<FieldKey, boolean>>;
}

export interface StoredItem extends ItemData {
  id: number;
  firstSeenAt: number;
  hasFullText: boolean;
}

export interface PreviewResult {
  items: ItemData[];
  found: number;
  kept: number;
  warnings: string[];
  pageTitle: string | null;
  finalUrl: string | null;
  durationMs: number;
  rendered: boolean;
}

export interface DiscoveredFeed {
  url: string;
  title: string | null;
  format: 'rss' | 'atom' | 'json';
}

export interface ListCandidate {
  itemSelector: string;
  fields: FieldRules;
  count: number;
  score: number;
  sample: ItemData[];
}

export interface JsonCandidate {
  itemsPath: string;
  fields: JsonFields;
  count: number;
  sample: ItemData[];
}

export interface RecipeMatch {
  recipeId: string;
  params: Record<string, string | boolean>;
  label: string;
}

export interface AnalyzeResult {
  url: string;
  finalUrl: string;
  kind: 'html' | 'json' | 'feed';
  title: string | null;
  description: string | null;
  iconUrl: string | null;
  existingFeeds: DiscoveredFeed[];
  recipes: RecipeMatch[];
  candidates: ListCandidate[];
  json: { candidates: JsonCandidate[]; embedSelector?: string } | null;
  feed: { title: string | null; itemCount: number } | null;
  /** redirectWall: host of the consent or login page the address was redirected to. */
  hints: { needsRender: boolean; browserAvailable: boolean; rendered: boolean; redirectWall: string | null };
}

export interface RecipeParam {
  key: string;
  label: string;
  type: 'text' | 'select' | 'checkbox';
  placeholder?: string;
  help?: string;
  required?: boolean;
  options?: { value: string; label: string }[];
  default?: string | boolean;
}

export interface RecipeInfo {
  id: string;
  name: string;
  description: string;
  /** simple-icons slug for the brand glyph (or a generic key). */
  icon: string;
  params: RecipeParam[];
}

export interface AppSettings {
  feedKeyRequired: boolean;
  feedKey: string;
  publicUrl: string;
  defaultRefreshMinutes: number;
  userAgent: string;
  acceptLanguage: string;
  rsshubBase: string;
}

export interface SystemInfo {
  version: string;
  node: string;
  authMode: 'password' | 'none';
  browser: { available: boolean; path: string | null };
  dataDir: string;
  dbSizeBytes: number;
  uptimeSec: number;
  feeds: number;
  items: number;
}

export interface AuthStatus {
  authenticated: boolean;
  setupRequired: boolean;
  authMode: 'password' | 'none';
}

export interface RefreshResult {
  ok: boolean;
  found: number;
  kept: number;
  added: number;
  error: string | null;
  warnings: string[];
  durationMs: number;
}

export interface FeedDraft {
  input: FeedInput;
  /** Where the draft came from, for the editor header. */
  origin?: 'analyze' | 'recipe' | 'manual';
}
