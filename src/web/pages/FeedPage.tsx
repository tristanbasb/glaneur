import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Copy, Ellipsis, Eraser, ExternalLink, Pause, Pencil, Play, RefreshCw, Trash2, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import type { StoredItem } from '../../shared/types';
import { DeleteFeedDialog } from '../components/DeleteFeedDialog';
import { FeedIcon } from '../components/FeedIcon';
import { Tally } from '../components/Tally';
import { Button, EmptyState, Menu, Segmented, Spinner } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { SOURCE_LABELS } from '../lib/fields';
import { domainOf, formatDateTime, formatDuration, formatInterval, formatNumber, plural, relativeTime } from '../lib/format';
import { useDocumentTitle, useTick } from '../lib/hooks';
import { copyFeedUrl } from './Dashboard';

type Format = 'rss' | 'atom' | 'json';

const FORMAT_LABELS: Record<Format, string> = { rss: 'RSS', atom: 'Atom', json: 'JSON Feed' };

const TRIGGERS: Record<string, string> = {
  schedule: 'Planifiée',
  manual: 'Manuelle',
  create: 'Création',
  edit: 'Modification',
  request: 'Lecteur',
};

function ItemRow({ item }: { item: StoredItem }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="item">
      <div className="item-main">
        {item.link ? (
          <a className="item-title" href={item.link} target="_blank" rel="noreferrer noopener">
            {item.title}
          </a>
        ) : (
          <span className="item-title">{item.title}</span>
        )}
        {item.summary && !open && <p className="item-summary">{item.summary}</p>}
        <p className="item-meta">
          <span className="mono">{item.date ? formatDateTime(item.date) : `repéré ${relativeTime(item.firstSeenAt)}`}</span>
          {item.author && <span>{item.author}</span>}
          {item.hasFullText && <span>texte complet</span>}
          {item.content && (
            <button type="button" className="item-expand" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
              {open ? 'Replier' : 'Lire ici'}
            </button>
          )}
        </p>
        {open && item.content && <div className="item-content" dangerouslySetInnerHTML={{ __html: item.content }} />}
      </div>
      {item.image && !open && <img className="item-thumb" src={item.image} alt="" loading="lazy" referrerPolicy="no-referrer" />}
    </li>
  );
}

export function FeedPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [format, setFormat] = useState<Format>('rss');
  const [confirmDelete, setConfirmDelete] = useState(false);
  useTick();

  const feed = useQuery({
    queryKey: ['feed', id],
    queryFn: () => api.feed(id),
    refetchInterval: (q) => (q.state.data?.running ? 2000 : 30_000),
  });
  const running = !!feed.data?.running;
  const items = useQuery({
    queryKey: ['items', id, feed.data?.lastFetchAt ?? 0],
    queryFn: () => api.items(id, 100),
    enabled: !!feed.data,
    placeholderData: (prev) => prev,
  });
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.settings, staleTime: 60_000 });
  useDocumentTitle(feed.data?.name);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['feed', id] });
    void qc.invalidateQueries({ queryKey: ['feeds'] });
  };

  const refresh = useMutation({
    mutationFn: () => api.refreshFeed(id),
    onSuccess: ({ result }) => {
      if (!result.ok) toast.error(result.error ?? 'Échec de l’actualisation');
      else toast.success(result.added ? plural(result.added, 'nouvel article', 'nouveaux articles') : 'Rien de nouveau pour l’instant');
    },
    onError: (err) => toast.error(err.message),
    onSettled: invalidate,
  });
  const toggle = useMutation({
    mutationFn: (enabled: boolean) => api.setEnabled(id, enabled),
    onSuccess: (f) => toast.success(f.enabled ? 'Flux réactivé' : 'Flux mis en pause'),
    onSettled: invalidate,
  });
  const clear = useMutation({
    mutationFn: () => api.clearItems(id),
    onSuccess: () => toast.success('Articles effacés, nouvelle lecture en cours'),
    onSettled: invalidate,
  });

  if (feed.isPending) {
    return (
      <div className="loading-block">
        <Spinner />
      </div>
    );
  }
  if (feed.isError) {
    const missing = feed.error instanceof ApiError && feed.error.status === 404;
    return (
      <EmptyState
        title={missing ? 'Ce flux n’existe plus' : 'Impossible de charger ce flux'}
        action={
          <Link to="/" className="btn btn-secondary">
            Retour à vos flux
          </Link>
        }
      >
        {missing ? 'Il a peut-être été supprimé.' : feed.error.message}
      </EmptyState>
    );
  }

  const f = feed.data;
  const busy = running || refresh.isPending;
  const history = [...f.history].reverse();

  return (
    <div className="feed-page">
      <Link to="/" className="back-link">
        <ArrowLeft size={16} aria-hidden /> Vos flux
      </Link>

      <header className="feed-head">
        <FeedIcon src={f.iconUrl} name={f.name} size={56} />
        <div className="feed-head-text">
          <p className="eyebrow">
            {SOURCE_LABELS[f.sourceType]}
            {!f.enabled && ' · en pause'}
          </p>
          <h1 className="display page-title">{f.name}</h1>
          <p className="feed-head-meta">
            {(f.siteUrl || f.sourceUrl) && (
              <a href={f.siteUrl || f.sourceUrl} target="_blank" rel="noreferrer noopener">
                {domainOf(f.siteUrl || f.sourceUrl)} <ExternalLink size={13} aria-hidden />
              </a>
            )}
            <span>{formatInterval(f.refreshMinutes)}</span>
            <span>créé {relativeTime(f.createdAt)}</span>
          </p>
        </div>
        <div className="feed-head-actions">
          <Button icon={<RefreshCw size={16} className={busy ? 'spin' : ''} />} onClick={() => refresh.mutate()} disabled={busy}>
            {busy ? 'Actualisation…' : 'Actualiser'}
          </Button>
          <Link to={`/feeds/${f.id}/edit`} className="btn btn-secondary">
            <Pencil size={16} aria-hidden />
            <span>Modifier</span>
          </Link>
          <Menu
            label="Plus d’actions"
            icon={<Ellipsis size={18} />}
            items={[
              { label: f.enabled ? 'Mettre en pause' : 'Reprendre', icon: f.enabled ? <Pause size={16} /> : <Play size={16} />, onSelect: () => toggle.mutate(!f.enabled) },
              { label: 'Effacer les articles enregistrés', icon: <Eraser size={16} />, onSelect: () => clear.mutate() },
              { label: 'Supprimer le flux', icon: <Trash2 size={16} />, danger: true, onSelect: () => setConfirmDelete(true) },
            ]}
          />
        </div>
      </header>

      <section className="subscribe card" aria-labelledby="subscribe-title">
        <div className="subscribe-head">
          <h2 id="subscribe-title" className="subscribe-title">
            Adresse du flux
          </h2>
          <Segmented<Format>
            label="Format du flux"
            size="sm"
            value={format}
            onChange={setFormat}
            options={(['rss', 'atom', 'json'] as Format[]).map((v) => ({ value: v, label: FORMAT_LABELS[v] }))}
          />
        </div>
        <div className="subscribe-row">
          <input className="input mono subscribe-url" readOnly value={f.urls[format]} aria-label={`Adresse ${FORMAT_LABELS[format]}`} onFocus={(e) => e.currentTarget.select()} />
          <Button variant="primary" icon={<Copy size={16} />} onClick={() => void copyFeedUrl(f.urls[format], FORMAT_LABELS[format])}>
            Copier
          </Button>
          <a className="btn btn-ghost" href={f.urls[format]} target="_blank" rel="noreferrer noopener">
            Ouvrir
          </a>
        </div>
        <p className="faint subscribe-hint">
          Collez cette adresse dans votre lecteur de flux (FreshRSS, Miniflux, Feedly, NetNewsWire…).
          {settings.data?.feedKeyRequired && ' Elle contient votre clé d’accès : gardez-la pour vous.'}
        </p>
      </section>

      <section className="health">
        <p className="health-line">
          {f.lastSuccessAt ? (
            <>
              Dernière lecture réussie <strong>{relativeTime(f.lastSuccessAt)}</strong>
            </>
          ) : busy ? (
            <strong>Première lecture en cours…</strong>
          ) : (
            'Pas encore de lecture réussie'
          )}
          {f.enabled && f.nextFetchAt && !busy && (
            <>
              {' '}
              · prochaine <strong>{relativeTime(f.nextFetchAt)}</strong>
            </>
          )}
          {' · '}
          <strong>{formatNumber(f.itemCount)}</strong> {f.itemCount > 1 ? 'articles enregistrés' : 'article enregistré'}
        </p>
        <div className="health-tally">
          <Tally history={f.history} slots={60} size="lg" />
          <div className="health-legend" aria-hidden>
            <span>
              <i className="legend-mark" style={{ background: 'var(--m-title)' }} />
              nouveaux articles
            </span>
            <span>
              <i className="legend-mark" style={{ background: 'var(--ink-3)', opacity: 0.5 }} />
              rien de neuf
            </span>
            <span>
              <i className="legend-mark" style={{ background: 'var(--error)' }} />
              erreur
            </span>
          </div>
        </div>
      </section>

      {f.enabled && f.lastError && (
        <div className="callout callout-error section-callout" role="alert">
          <TriangleAlert size={18} aria-hidden />
          <div className="callout-body">
            <p>
              <strong>La dernière lecture a échoué</strong> ({relativeTime(f.lastFetchAt)}) : {f.lastError}
            </p>
            <Link to={`/feeds/${f.id}/edit`} className="btn btn-secondary btn-sm">
              Vérifier la configuration
            </Link>
          </div>
        </div>
      )}

      <section className="section">
        <div className="section-head">
          <h2 className="display section-title">Derniers articles</h2>
        </div>
        {items.isPending ? (
          <div className="loading-block">
            <Spinner />
          </div>
        ) : !items.data?.length ? (
          <EmptyState title={busy ? 'Lecture en cours…' : 'Aucun article pour l’instant'}>
            {busy ? 'Les articles apparaîtront ici dans quelques secondes.' : 'Actualisez le flux ou vérifiez sa configuration.'}
          </EmptyState>
        ) : (
          <ul className="item-list">
            {items.data.map((item) => (
              <ItemRow key={item.id} item={item} />
            ))}
          </ul>
        )}
      </section>

      {history.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2 className="display section-title">Journal</h2>
          </div>
          <div className="log-wrap">
            <table className="log-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Résultat</th>
                  <th className="num">Trouvés</th>
                  <th className="num">Nouveaux</th>
                  <th className="num">Durée</th>
                  <th>Origine</th>
                </tr>
              </thead>
              <tbody>
                {history.map((e) => (
                  <tr key={e.at}>
                    <td className="nowrap">{formatDateTime(e.at)}</td>
                    <td className={e.ok ? '' : 'log-error'}>{e.ok ? 'Réussie' : e.error}</td>
                    <td className="num">{e.ok ? e.found : '—'}</td>
                    <td className="num">{e.ok ? e.added : '—'}</td>
                    <td className="num">{formatDuration(e.ms)}</td>
                    <td className="faint">{TRIGGERS[e.trigger ?? ''] ?? e.trigger}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <DeleteFeedDialog feed={confirmDelete ? f : null} onClose={() => setConfirmDelete(false)} onDeleted={() => navigate('/')} />
    </div>
  );
}
