import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Copy, Ellipsis, ExternalLink, Link2, Pause, Pencil, Play, RefreshCw, Search, Trash2 } from 'lucide-react';
import { type FormEvent, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { toast } from 'sonner';
import type { FeedSummary } from '../../shared/types';
import { BrandIcon } from '../components/BrandIcon';
import { DeleteFeedDialog } from '../components/DeleteFeedDialog';
import { FeedIcon } from '../components/FeedIcon';
import { Tally } from '../components/Tally';
import { Badge, Button, EmptyState, IconButton, Menu, Segmented, Spinner } from '../components/ui';
import { api } from '../lib/api';
import { copyText } from '../lib/clipboard';
import { SOURCE_LABELS } from '../lib/fields';
import { domainOf, formatDateTime, formatInterval, formatNumber, plural, relativeTime } from '../lib/format';

const QUICK_RECIPES = [
  ['youtube', 'YouTube'],
  ['telegram', 'Telegram'],
  ['bluesky', 'Bluesky'],
  ['github', 'GitHub'],
  ['reddit', 'Reddit'],
  ['mastodon', 'Mastodon'],
] as const;

type Filter = 'all' | 'errors' | 'paused';

function fold(value: string): string {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

export async function copyFeedUrl(url: string, label: string) {
  if (await copyText(url)) toast.success(`Adresse ${label} copiée`);
  else toast.error('Copie impossible : sélectionnez l’adresse à la main.');
}

function UrlBox() {
  const navigate = useNavigate();
  const [url, setUrl] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const value = url.trim();
    if (value) navigate(`/new?url=${encodeURIComponent(value)}`);
  };
  return (
    <section className="glean card">
      <div>
        <h1 className="display glean-title">Suivre une nouvelle page</h1>
        <p className="glean-lede">Collez l’adresse d’un site sans flux RSS. Glaneur repère la liste des articles, ou vous la désignez d’un clic.</p>
      </div>
      <form className="glean-form" onSubmit={submit}>
        <label className="sr-only" htmlFor="glean-url">
          Adresse de la page
        </label>
        <div className="glean-field">
          <Link2 size={18} aria-hidden className="glean-field-icon" />
          <input
            id="glean-url"
            className="glean-input"
            type="text"
            inputMode="url"
            autoComplete="url"
            spellCheck={false}
            placeholder="https://exemple.fr/actualites"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <span className="glean-stroke" aria-hidden />
        </div>
        <Button type="submit" variant="primary" size="lg" disabled={!url.trim()}>
          Analyser <ArrowRight size={18} aria-hidden className="btn-trailing" />
        </Button>
      </form>
      <div className="glean-recipes">
        <span className="faint">Ou partir d’une recette :</span>
        {QUICK_RECIPES.map(([id, name]) => (
          <Link key={id} to={`/recipes?open=${id}`} className="chip">
            <BrandIcon name={id} size={14} />
            {name}
          </Link>
        ))}
        <Link to="/recipes" className="chip chip-more">
          Toutes les recettes
        </Link>
      </div>
    </section>
  );
}

function FeedRow({ feed, onDelete }: { feed: FeedSummary; onDelete: (feed: FeedSummary) => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const refresh = useMutation({
    mutationFn: () => api.refreshFeed(feed.id),
    onSuccess: ({ result }) => {
      if (!result.ok) toast.error(`« ${feed.name} » : ${result.error}`);
      else if (result.added) toast.success(`${plural(result.added, 'nouvel article', 'nouveaux articles')} dans « ${feed.name} »`);
      else toast.success(`« ${feed.name} » est à jour`);
    },
    onError: (err) => toast.error(err.message),
    onSettled: () => qc.invalidateQueries({ queryKey: ['feeds'] }),
  });
  const toggle = useMutation({
    mutationFn: () => api.setEnabled(feed.id, !feed.enabled),
    onSuccess: (f) => toast.success(f.enabled ? 'Flux réactivé' : 'Flux mis en pause'),
    onError: (err) => toast.error(err.message),
    onSettled: () => qc.invalidateQueries({ queryKey: ['feeds'] }),
  });

  const running = feed.running || refresh.isPending;
  const failing = feed.enabled && !!feed.lastError;

  return (
    <li className={`feed-row ${feed.enabled ? '' : 'is-paused'}`}>
      <Link to={`/feeds/${feed.id}`} className="feed-row-main">
        <FeedIcon src={feed.iconUrl} name={feed.name} size={38} />
        <span className="feed-row-text">
          <span className="feed-row-title">
            <span className="feed-row-name">{feed.name}</span>
            {running ? (
              <Badge tone="run">
                <Spinner size={11} label="Actualisation" /> Actualisation
              </Badge>
            ) : !feed.enabled ? (
              <Badge>En pause</Badge>
            ) : failing ? (
              <Badge tone="error">Erreur</Badge>
            ) : null}
          </span>
          <span className="feed-row-meta">
            {domainOf(feed.siteUrl || feed.sourceUrl)} · {SOURCE_LABELS[feed.sourceType]} · {formatInterval(feed.refreshMinutes)}
          </span>
          {failing && <span className="feed-row-error">{feed.lastError}</span>}
        </span>
      </Link>
      <div className="feed-row-tally">
        <Tally history={feed.history} />
      </div>
      <div className="feed-row-count">
        <strong>{formatNumber(feed.itemCount)}</strong>
        <span>{feed.itemCount > 1 ? 'articles' : 'article'}</span>
      </div>
      <div className="feed-row-time" title={feed.nextFetchAt && feed.enabled ? `Prochaine actualisation ${relativeTime(feed.nextFetchAt)} (${formatDateTime(feed.nextFetchAt)})` : undefined}>
        {feed.lastSuccessAt ? relativeTime(feed.lastSuccessAt) : '—'}
      </div>
      <div className="feed-row-actions">
        <IconButton label="Copier l’adresse RSS" onClick={() => void copyFeedUrl(feed.urls.rss, 'RSS')}>
          <Copy size={17} />
        </IconButton>
        <IconButton label="Actualiser maintenant" onClick={() => refresh.mutate()} disabled={running}>
          <RefreshCw size={17} className={running ? 'spin' : ''} />
        </IconButton>
        <Menu
          label="Plus d’actions"
          icon={<Ellipsis size={18} />}
          items={[
            { label: 'Modifier', icon: <Pencil size={16} />, onSelect: () => navigate(`/feeds/${feed.id}/edit`) },
            { label: 'Copier l’adresse Atom', icon: <Copy size={16} />, onSelect: () => void copyFeedUrl(feed.urls.atom, 'Atom') },
            { label: 'Copier l’adresse JSON Feed', icon: <Copy size={16} />, onSelect: () => void copyFeedUrl(feed.urls.json, 'JSON Feed') },
            ...(feed.siteUrl ? [{ label: 'Ouvrir le site', icon: <ExternalLink size={16} />, onSelect: () => window.open(feed.siteUrl, '_blank', 'noopener') }] : []),
            { label: feed.enabled ? 'Mettre en pause' : 'Reprendre', icon: feed.enabled ? <Pause size={16} /> : <Play size={16} />, onSelect: () => toggle.mutate() },
            { label: 'Supprimer', icon: <Trash2 size={16} />, danger: true, onSelect: () => onDelete(feed) },
          ]}
        />
      </div>
    </li>
  );
}

export function Dashboard() {
  const feeds = useQuery({
    queryKey: ['feeds'],
    queryFn: api.feeds,
    refetchInterval: (q) => (q.state.data?.some((f) => f.running) ? 2000 : 30_000),
  });
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [toDelete, setToDelete] = useState<FeedSummary | null>(null);

  const all = feeds.data ?? [];
  const errors = all.filter((f) => f.enabled && f.lastError).length;
  const paused = all.filter((f) => !f.enabled).length;
  const items = all.reduce((n, f) => n + f.itemCount, 0);

  const visible = useMemo(() => {
    const needle = fold(search.trim());
    return all.filter((f) => {
      if (filter === 'errors' && !(f.enabled && f.lastError)) return false;
      if (filter === 'paused' && f.enabled) return false;
      return !needle || fold(`${f.name} ${f.siteUrl} ${f.sourceUrl}`).includes(needle);
    });
  }, [all, filter, search]);

  return (
    <>
      <UrlBox />

      <section className="section">
        <div className="section-head">
          <div>
            <h2 className="display section-title">Vos flux</h2>
            {all.length > 0 && (
              <p className="faint section-sub">
                {plural(all.length, 'flux', 'flux')} · {plural(items, 'article', 'articles')}
                {errors > 0 && ` · ${errors} en erreur`}
              </p>
            )}
          </div>
          {all.length > 0 && (
            <div className="feeds-toolbar">
              <div className="search">
                <Search size={16} aria-hidden />
                <input className="input" type="search" placeholder="Rechercher un flux" aria-label="Rechercher un flux" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              <Segmented<Filter>
                label="Filtrer les flux"
                value={filter}
                onChange={setFilter}
                options={[
                  { value: 'all', label: `Tous · ${all.length}` },
                  { value: 'errors', label: `Erreurs · ${errors}` },
                  { value: 'paused', label: `En pause · ${paused}` },
                ]}
              />
            </div>
          )}
        </div>

        {feeds.isPending ? (
          <div className="loading-block">
            <Spinner />
          </div>
        ) : feeds.isError ? (
          <p className="callout callout-error">{feeds.error.message}</p>
        ) : all.length === 0 ? (
          <EmptyState
            title="Aucun flux pour l’instant"
            action={
              <Link to="/recipes" className="btn btn-secondary">
                Voir les recettes
              </Link>
            }
          >
            Collez l’adresse d’une page ci-dessus, ou partez d’une recette pour YouTube, Telegram, GitHub et d’autres.
          </EmptyState>
        ) : visible.length === 0 ? (
          <p className="faint no-results">Aucun flux ne correspond.</p>
        ) : (
          <ul className="feed-list">
            {visible.map((feed) => (
              <FeedRow key={feed.id} feed={feed} onDelete={setToDelete} />
            ))}
          </ul>
        )}
      </section>

      <DeleteFeedDialog feed={toDelete} onClose={() => setToDelete(null)} />
    </>
  );
}
