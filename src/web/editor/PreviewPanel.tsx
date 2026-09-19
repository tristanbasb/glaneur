import type { UseQueryResult } from '@tanstack/react-query';
import { RotateCw } from 'lucide-react';
import type { FieldKey, ItemData, PreviewResult, SourceType } from '../../shared/types';
import { Button, Spinner } from '../components/ui';
import { formatDateTime, formatDuration, plural } from '../lib/format';

function shortLink(link: string): string {
  try {
    const u = new URL(link);
    const path = u.pathname.length > 32 ? `${u.pathname.slice(0, 30)}…` : u.pathname;
    return `${u.hostname.replace(/^www\./, '')}${path === '/' ? '' : path}`;
  } catch {
    return link;
  }
}

function PreviewCard({ item, trackFields }: { item: ItemData; trackFields: boolean }) {
  const from = (key: FieldKey) => !trackFields || !!item.found?.[key];
  return (
    <article className="preview-card">
      <div className="pv-main">
        <p className="pv-title">
          <span className={from('title') ? 'pv-mark' : ''}>{item.title}</span>
          {!from('title') && <span className="pv-derived"> · titre déduit</span>}
        </p>
        {item.summary && <p className={`pv-summary ${from('description') ? 'from-page' : ''}`}>{item.summary}</p>}
        <p className="pv-meta">
          {item.link ? (
            <a className={`pv-tag ${from('link') ? '' : 'is-derived'}`} style={{ '--mk': 'var(--m-link)' } as React.CSSProperties} href={item.link} target="_blank" rel="noreferrer noopener" title={item.link}>
              {shortLink(item.link)}
            </a>
          ) : (
            <span className="pv-tag is-missing">sans lien</span>
          )}
          {item.date ? (
            <span className="pv-tag" style={{ '--mk': 'var(--m-date)' } as React.CSSProperties}>
              {formatDateTime(item.date)}
            </span>
          ) : (
            <span className="pv-tag is-derived">date de détection</span>
          )}
          {item.author && (
            <span className="pv-tag" style={{ '--mk': 'var(--m-author)' } as React.CSSProperties}>
              {item.author}
            </span>
          )}
        </p>
      </div>
      {item.image && <img className="pv-thumb" src={item.image} alt="" loading="lazy" referrerPolicy="no-referrer" />}
    </article>
  );
}

interface Props {
  query: UseQueryResult<PreviewResult, Error>;
  sourceType: SourceType;
  ready: boolean;
  notReady: string;
  onReload: () => void;
  reloading: boolean;
}

export function PreviewPanel({ query, sourceType, ready, notReady, onReload, reloading }: Props) {
  const data = query.data;
  const trackFields = sourceType === 'html' || sourceType === 'json';
  return (
    <section className="panel-section" aria-live="polite">
      <div className="panel-section-head">
        <h3 className="panel-section-title">Aperçu du flux</h3>
        {ready && (
          <Button size="sm" variant="ghost" icon={<RotateCw size={14} className={reloading ? 'spin' : ''} />} onClick={onReload} disabled={reloading}>
            Relire la page
          </Button>
        )}
      </div>

      {!ready ? (
        <p className="panel-note">{notReady}</p>
      ) : (
        <>
          {query.isError && <p className="callout callout-error">{query.error.message}</p>}
          {!data && query.isFetching && (
            <p className="preview-status">
              <Spinner size={14} /> Lecture de la page…
            </p>
          )}
          {data && (
            <>
              <p className="preview-status">
                <strong>{plural(data.found, sourceType === 'watch' ? 'instantané' : 'article trouvé', sourceType === 'watch' ? 'instantanés' : 'articles trouvés')}</strong>
                {data.kept !== data.found && <span>· {data.kept} après filtres</span>}
                <span>· {formatDuration(data.durationMs)}</span>
                {data.rendered && <span>· rendu JavaScript</span>}
                {query.isFetching && <Spinner size={12} />}
              </p>
              {data.warnings.map((w) => (
                <p key={w} className="callout callout-warn">
                  {w}
                </p>
              ))}
              <div className="preview-list">
                {data.items.slice(0, 30).map((item) => (
                  <PreviewCard key={item.guid} item={item} trackFields={trackFields} />
                ))}
              </div>
              {data.items.length > 30 && <p className="panel-note">… et {data.items.length - 30} autres.</p>}
            </>
          )}
        </>
      )}
    </section>
  );
}
