// Ready-made feeds for popular platforms, in the spirit of RSS-Bridge "bridges".
import type { FeedInput, FilterRule, RecipeInfo, RecipeMatch } from '../shared/types.js';
import { loadHtml } from './core/extract-html.js';
import { parseFeed } from './core/feedparse.js';
import { ACCEPT_FEED, fetchText, normalizeUrl } from './core/http.js';
import { defaultOptions, ValidationError } from './feeds.js';
import { getSettings } from './settings.js';
import { errorMessage, truncate } from './util.js';

type Params = Record<string, string | boolean>;

interface Recipe extends RecipeInfo {
  match?: (url: URL) => Params | null;
  matchLabel?: string;
  build: (params: Params) => Promise<FeedInput>;
}

function required(params: Params, key: string, label: string): string {
  const v = params[key];
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s) throw new ValidationError(`${label} : champ requis.`);
  return s;
}

function choice(params: Params, key: string, allowed: string[], fallback: string): string {
  const v = params[key];
  return typeof v === 'string' && allowed.includes(v) ? v : fallback;
}

function base(recipe: string, name: string, source: FeedInput['source'], extra: Partial<FeedInput> = {}): FeedInput {
  return {
    name: truncate(name, 120),
    enabled: true,
    recipe,
    description: '',
    siteUrl: '',
    iconUrl: '',
    source,
    options: defaultOptions(),
    ...extra,
  };
}

/** Builds a feed-merge source after checking that the feed is readable. */
async function fromFeed(recipe: string, url: string, extra: { name?: string; siteUrl?: string; iconUrl?: string; filters?: FilterRule[] } = {}): Promise<FeedInput> {
  let title: string | null = null;
  let link: string | null = null;
  let icon: string | null = null;
  let description: string | null = null;
  try {
    const r = await fetchText(url, { accept: ACCEPT_FEED, timeoutMs: 20_000 });
    const feed = parseFeed(r.body, r.finalUrl);
    ({ title, link, description } = feed);
    icon = feed.iconUrl;
  } catch (err) {
    throw new ValidationError(`Impossible de lire ${url} : ${errorMessage(err)}`);
  }
  const input = base(recipe, extra.name ?? title ?? 'Nouveau flux', { type: 'feed', urls: [url] }, {
    siteUrl: extra.siteUrl ?? link ?? '',
    iconUrl: extra.iconUrl ?? icon ?? '',
    description: truncate(description ?? '', 480),
  });
  if (extra.filters) input.options.filters = extra.filters;
  return input;
}

// ---- YouTube --------------------------------------------------------------------------------------

async function resolveYoutubeChannel(input: string): Promise<{ id: string; name: string | null }> {
  const direct = /\b(UC[\w-]{22})\b/.exec(input)?.[1];
  if (direct) return { id: direct, name: null };
  let pageUrl: string;
  if (input.startsWith('@')) pageUrl = `https://www.youtube.com/${input}`;
  else if (/youtube\.com|youtu\.be|^https?:/i.test(input)) pageUrl = normalizeUrl(input);
  else pageUrl = `https://www.youtube.com/@${input}`;
  let html: string;
  try {
    html = (await fetchText(pageUrl, { timeoutMs: 20_000 })).body;
  } catch (err) {
    throw new ValidationError(`Chaîne YouTube introuvable (${errorMessage(err)})`);
  }
  const id =
    /<link rel="alternate" type="application\/rss\+xml"[^>]*channel_id=(UC[\w-]{22})/.exec(html)?.[1] ??
    /<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]{22})"/.exec(html)?.[1] ??
    /<meta itemprop="(?:channelId|identifier)" content="(UC[\w-]{22})"/.exec(html)?.[1] ??
    /"externalId":"(UC[\w-]{22})"/.exec(html)?.[1] ??
    /"channelId":"(UC[\w-]{22})"/.exec(html)?.[1];
  if (!id) throw new ValidationError('Chaîne YouTube introuvable : vérifiez l’adresse ou le @pseudo.');
  const name = loadHtml(html)('meta[property="og:title"]').attr('content')?.trim() || null;
  return { id, name };
}

const youtube: Recipe = {
  id: 'youtube',
  name: 'YouTube',
  icon: 'youtube',
  description: 'Les nouvelles vidéos d’une chaîne ou d’une playlist, sans les Shorts si vous le souhaitez.',
  params: [
    { key: 'channel', label: 'Chaîne ou playlist', type: 'text', placeholder: '@Computerphile ou https://www.youtube.com/…', required: true },
    { key: 'noShorts', label: 'Exclure les Shorts et les directs', type: 'checkbox', default: true },
  ],
  matchLabel: 'Chaîne YouTube',
  match: (u) => (/(^|\.)youtube\.com$|^youtu\.be$/.test(u.hostname) ? { channel: u.href, noShorts: true } : null),
  async build(p) {
    const input = required(p, 'channel', 'Chaîne ou playlist');
    const playlist = /[?&]list=([\w-]{10,})/.exec(input)?.[1];
    if (playlist) {
      return fromFeed('youtube', `https://www.youtube.com/feeds/videos.xml?playlist_id=${playlist}`, {
        siteUrl: `https://www.youtube.com/playlist?list=${playlist}`,
        iconUrl: 'https://www.youtube.com/favicon.ico',
      });
    }
    const channel = await resolveYoutubeChannel(input);
    const channelFeed = `https://www.youtube.com/feeds/videos.xml?channel_id=${channel.id}`;
    const url = p.noShorts === false ? channelFeed : `https://www.youtube.com/feeds/videos.xml?playlist_id=UULF${channel.id.slice(2)}`;
    let name = channel.name;
    if (!name) {
      try {
        name = parseFeed((await fetchText(channelFeed, { accept: ACCEPT_FEED })).body, channelFeed).title;
      } catch {
        name = null;
      }
    }
    return fromFeed('youtube', url, {
      name: name ? `${name} · YouTube` : undefined,
      siteUrl: `https://www.youtube.com/channel/${channel.id}`,
      iconUrl: 'https://www.youtube.com/favicon.ico',
    });
  },
};

// ---- Telegram -------------------------------------------------------------------------------------

const telegram: Recipe = {
  id: 'telegram',
  name: 'Telegram',
  icon: 'telegram',
  description: 'Les messages d’un canal public, avec leurs images et leurs liens.',
  params: [{ key: 'channel', label: 'Canal public', type: 'text', placeholder: '@durov ou https://t.me/durov', required: true }],
  matchLabel: 'Canal Telegram',
  match: (u) => {
    if (!/^(t|telegram)\.me$/.test(u.hostname)) return null;
    const parts = u.pathname.split('/').filter(Boolean);
    const name = parts[0] === 's' ? parts[1] : parts[0];
    return name && /^[A-Za-z]\w{3,}$/.test(name) ? { channel: name } : null;
  },
  async build(p) {
    const raw = required(p, 'channel', 'Canal public');
    const name = /(?:t|telegram)\.me\/(?:s\/)?([A-Za-z]\w{3,})/.exec(raw)?.[1] ?? raw.replace(/^@/, '');
    if (!/^[A-Za-z]\w{3,}$/.test(name)) throw new ValidationError('Nom de canal invalide.');
    const url = `https://t.me/s/${name}`;
    let page;
    try {
      page = await fetchText(url, { timeoutMs: 20_000 });
    } catch (err) {
      throw new ValidationError(`Telegram ne répond pas : ${errorMessage(err)}`);
    }
    if (!page.finalUrl.includes('/s/') || !page.body.includes('tgme_widget_message_wrap')) {
      throw new ValidationError(`Le canal « ${name} » est introuvable ou n’autorise pas l’aperçu public.`);
    }
    const $ = loadHtml(page.body);
    const meta = (prop: string) => $(`meta[property="${prop}"]`).attr('content')?.trim() ?? '';
    return base(
      'telegram',
      meta('og:title') ? `${meta('og:title')} · Telegram` : `Telegram · ${name}`,
      {
        type: 'html',
        url,
        render: { enabled: false },
        itemSelector: '.tgme_widget_message_wrap',
        fields: {
          link: { selector: 'a.tgme_widget_message_date', attr: 'href' },
          description: { selector: '.tgme_widget_message_text.js-message_text', attr: 'html' },
          date: { selector: 'time', attr: 'datetime' },
          image: { selector: '.tgme_widget_message_photo_wrap, .tgme_widget_message_video_thumb', attr: 'src' },
          author: { selector: '.tgme_widget_message_owner_name', attr: 'text' },
        },
      },
      { siteUrl: `https://t.me/${name}`, iconUrl: meta('og:image'), description: truncate(meta('og:description'), 480) },
    );
  },
};

// ---- Social & code --------------------------------------------------------------------------------

const bluesky: Recipe = {
  id: 'bluesky',
  name: 'Bluesky',
  icon: 'bluesky',
  description: 'Les publications d’un profil Bluesky.',
  params: [{ key: 'handle', label: 'Profil', type: 'text', placeholder: 'bsky.app ou https://bsky.app/profile/…', required: true }],
  matchLabel: 'Profil Bluesky',
  match: (u) => {
    const handle = u.hostname === 'bsky.app' ? /^\/profile\/([^/]+)/.exec(u.pathname)?.[1] : null;
    return handle ? { handle } : null;
  },
  async build(p) {
    const raw = required(p, 'handle', 'Profil');
    const handle = /profile\/([^/?#]+)/.exec(raw)?.[1] ?? raw.replace(/^@/, '');
    return fromFeed('bluesky', `https://bsky.app/profile/${encodeURIComponent(handle)}/rss`, {
      siteUrl: `https://bsky.app/profile/${handle}`,
      iconUrl: 'https://bsky.app/static/favicon-32x32.png',
    });
  },
};

const mastodon: Recipe = {
  id: 'mastodon',
  name: 'Mastodon',
  icon: 'mastodon',
  description: 'Les publications publiques d’un compte du Fediverse (Mastodon, GoToSocial…).',
  params: [{ key: 'account', label: 'Compte', type: 'text', placeholder: '@Gargron@mastodon.social', required: true }],
  matchLabel: 'Compte Mastodon',
  match: (u) => (/^\/@[\w.]+\/?$/.test(u.pathname) && !/(^|\.)medium\.com$|(^|\.)youtube\.com$|(^|\.)tiktok\.com$/.test(u.hostname) ? { account: u.href } : null),
  async build(p) {
    const raw = required(p, 'account', 'Compte');
    const fromUrl = /^https?:\/\/([^/]+)\/@([\w.]+)/.exec(raw);
    const fromHandle = /^@?([\w.]+)@([\w.-]+\.[a-z]{2,})$/i.exec(raw);
    const instance = fromUrl?.[1] ?? fromHandle?.[2];
    const user = fromUrl?.[2] ?? fromHandle?.[1];
    if (!instance || !user) throw new ValidationError('Format attendu : @utilisateur@instance ou l’adresse du profil.');
    return fromFeed('mastodon', `https://${instance}/@${user}.rss`, { siteUrl: `https://${instance}/@${user}` });
  },
};

const reddit: Recipe = {
  id: 'reddit',
  name: 'Reddit',
  icon: 'reddit',
  description: 'Les publications d’un subreddit ou d’un utilisateur.',
  params: [
    { key: 'target', label: 'Subreddit ou utilisateur', type: 'text', placeholder: 'r/selfhosted ou u/spez', required: true },
    {
      key: 'sort',
      label: 'Tri',
      type: 'select',
      default: 'new',
      options: [
        { value: 'new', label: 'Nouveaux' },
        { value: 'hot', label: 'Populaires' },
        { value: 'top', label: 'Meilleurs' },
        { value: 'rising', label: 'En hausse' },
      ],
    },
  ],
  matchLabel: 'Reddit',
  match: (u) => {
    if (!/(^|\.)reddit\.com$/.test(u.hostname)) return null;
    const m = /^\/(r|u|user)\/([\w-]+)/.exec(u.pathname);
    return m ? { target: `${m[1] === 'r' ? 'r' : 'u'}/${m[2]}`, sort: 'new' } : null;
  },
  async build(p) {
    const raw = required(p, 'target', 'Subreddit ou utilisateur');
    const m = /(?:^|\/)(r|u|user)\/([\w-]+)/.exec(raw);
    const kind = m ? (m[1] === 'r' ? 'r' : 'u') : 'r';
    const name = m?.[2] ?? raw.replace(/^\/+/, '');
    if (!/^[\w-]+$/.test(name)) throw new ValidationError('Nom de subreddit ou d’utilisateur invalide.');
    const sort = choice(p, 'sort', ['new', 'hot', 'top', 'rising'], 'new');
    const url =
      kind === 'r'
        ? `https://www.reddit.com/r/${name}/${sort === 'hot' ? '' : `${sort}/`}.rss`
        : `https://www.reddit.com/user/${name}/submitted/.rss`;
    return fromFeed('reddit', url, {
      name: kind === 'r' ? `r/${name} · Reddit` : `u/${name} · Reddit`,
      siteUrl: kind === 'r' ? `https://www.reddit.com/r/${name}/` : `https://www.reddit.com/user/${name}/`,
      iconUrl: 'https://www.redditstatic.com/shreddit/assets/favicon/192x192.png',
    });
  },
};

const GITHUB_KINDS: Record<string, string> = { releases: 'versions', tags: 'tags', commits: 'commits' };

const github: Recipe = {
  id: 'github',
  name: 'GitHub',
  icon: 'github',
  description: 'Les versions, tags ou commits d’un dépôt — idéal pour suivre vos applications auto-hébergées.',
  params: [
    { key: 'repo', label: 'Dépôt', type: 'text', placeholder: 'immich-app/immich', required: true },
    {
      key: 'kind',
      label: 'Suivre',
      type: 'select',
      default: 'releases',
      options: [
        { value: 'releases', label: 'Les versions' },
        { value: 'tags', label: 'Les tags' },
        { value: 'commits', label: 'Les commits' },
      ],
    },
  ],
  matchLabel: 'Dépôt GitHub',
  match: (u) => {
    if (u.hostname !== 'github.com') return null;
    const parts = u.pathname.split('/').filter(Boolean);
    return parts.length >= 2 ? { repo: `${parts[0]}/${parts[1]}`, kind: 'releases' } : null;
  },
  async build(p) {
    const raw = required(p, 'repo', 'Dépôt');
    const repo = (/github\.com\/([\w.-]+\/[\w.-]+)/.exec(raw)?.[1] ?? raw).replace(/\.git$/, '');
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new ValidationError('Format attendu : propriétaire/dépôt.');
    const kind = choice(p, 'kind', Object.keys(GITHUB_KINDS), 'releases');
    return fromFeed('github', `https://github.com/${repo}/${kind}.atom`, {
      name: `${repo} · ${GITHUB_KINDS[kind]}`,
      siteUrl: `https://github.com/${repo}`,
      iconUrl: 'https://github.githubassets.com/favicons/favicon.svg',
    });
  },
};

// ---- Search & bridges -----------------------------------------------------------------------------

const EDITIONS: Record<string, string> = {
  fr: 'hl=fr&gl=FR&ceid=FR:fr',
  be: 'hl=fr&gl=BE&ceid=BE:fr',
  ca: 'hl=fr-CA&gl=CA&ceid=CA:fr',
  'en-US': 'hl=en-US&gl=US&ceid=US:en',
  'en-GB': 'hl=en-GB&gl=GB&ceid=GB:en',
};

const googlenews: Recipe = {
  id: 'googlenews',
  name: 'Google Actualités',
  icon: 'googlenews',
  description: 'Les articles de presse qui correspondent à une recherche.',
  params: [
    { key: 'query', label: 'Recherche', type: 'text', placeholder: 'proxmox OR "home assistant"', required: true },
    {
      key: 'edition',
      label: 'Édition',
      type: 'select',
      default: 'fr',
      options: [
        { value: 'fr', label: 'France' },
        { value: 'be', label: 'Belgique' },
        { value: 'ca', label: 'Canada (français)' },
        { value: 'en-US', label: 'États-Unis' },
        { value: 'en-GB', label: 'Royaume-Uni' },
      ],
    },
  ],
  async build(p) {
    const query = required(p, 'query', 'Recherche');
    const edition = choice(p, 'edition', Object.keys(EDITIONS), 'fr');
    return fromFeed('googlenews', `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&${EDITIONS[edition]}`, {
      name: `${query} · Google Actualités`,
      siteUrl: `https://news.google.com/search?q=${encodeURIComponent(query)}&${EDITIONS[edition]}`,
      iconUrl: 'https://news.google.com/favicon.ico',
    });
  },
};

const rsshub: Recipe = {
  id: 'rsshub',
  name: 'Route RSSHub',
  icon: 'rss',
  description: 'Pour les sites très protégés (Instagram, X, TikTok…) : passez par une instance RSSHub et gérez le flux ici.',
  params: [
    { key: 'route', label: 'Route', type: 'text', placeholder: '/instagram/user/nasa', required: true, help: 'Catalogue des routes : docs.rsshub.app. L’instance utilisée se règle dans les réglages.' },
  ],
  async build(p) {
    const raw = required(p, 'route', 'Route');
    let route = raw;
    if (/^https?:\/\//i.test(raw)) {
      const u = new URL(raw);
      route = u.pathname + u.search;
    }
    if (!route.startsWith('/')) route = `/${route}`;
    return fromFeed('rsshub', `${getSettings().rsshubBase}${route}`);
  },
};

const RECIPES: Recipe[] = [youtube, telegram, bluesky, mastodon, reddit, github, googlenews, rsshub];

export function recipeInfos(): RecipeInfo[] {
  return RECIPES.map(({ id, name, description, icon, params }) => ({ id, name, description, icon, params }));
}

export function matchRecipes(url: string): RecipeMatch[] {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return [];
  }
  return RECIPES.flatMap((r) => {
    const params = r.match?.(u);
    return params ? [{ recipeId: r.id, params, label: r.matchLabel ?? r.name }] : [];
  });
}

export async function buildRecipe(id: string, params: unknown): Promise<FeedInput> {
  const recipe = RECIPES.find((r) => r.id === id);
  if (!recipe) throw new ValidationError('Recette inconnue.');
  const clean: Params = {};
  if (params && typeof params === 'object') {
    for (const [k, v] of Object.entries(params)) if (typeof v === 'string' || typeof v === 'boolean') clean[k] = v;
  }
  return recipe.build(clean);
}
