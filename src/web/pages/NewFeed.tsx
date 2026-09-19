import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Braces, Copy, Eye, Merge, MousePointerClick, RotateCw, Sparkles, TriangleAlert } from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import type { AnalyzeResult, FeedInput, FieldKey, ItemData } from '../../shared/types';
import { BrandIcon } from '../components/BrandIcon';
import { FeedIcon } from '../components/FeedIcon';
import { Badge, Button } from '../components/ui';
import { api } from '../lib/api';
import { copyText } from '../lib/clipboard';
import { feedDraft, htmlDraft, jsonDraft, watchDraft } from '../lib/drafts';
import { FIELD_META, FIELD_ORDER } from '../lib/fields';
import { domainOf, formatShortDate, plural } from '../lib/format';
import { useDocumentTitle } from '../lib/hooks';

function FieldChips({ fields }: { fields: Partial<Record<FieldKey, unknown>> }) {
  const present = FIELD_ORDER.filter((k) => fields[k]);
  if (!present.length) return null;
  return (
    <div className="field-chips" aria-label="Champs repérés">
      {present.map((k) => (
        <span key={k} className="field-chip" style={{ '--mk': FIELD_META[k].color } as React.CSSProperties}>
          {FIELD_META[k].label}
        </span>
      ))}
    </div>
  );
}

function SampleList({ items }: { items: ItemData[] }) {
  return (
    <ol className="sample-list">
      {items.slice(0, 4).map((item) => (
        <li key={item.guid}>
          <span className="sample-title">{item.title}</span>
          {item.date && <span className="sample-date mono">{formatShortDate(item.date)}</span>}
        </li>
      ))}
    </ol>
  );
}

function Analyzing({ url }: { url: string }) {
  return (
    <div className="analyzing card" role="status">
      <div className="analyzing-lines" aria-hidden>
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className="analyzing-line" style={{ '--i': i } as React.CSSProperties} />
        ))}
      </div>
      <div>
        <p className="display analyzing-title">Lecture de la page…</p>
        <p className="faint">
          Glaneur cherche un flux existant et les listes d’articles sur <span className="mono">{domainOf(url)}</span>.
        </p>
      </div>
    </div>
  );
}

export function ToolCards({ onPick }: { onPick: (kind: 'html' | 'watch' | 'json' | 'feed') => void }) {
  const tools = [
    { kind: 'html' as const, icon: <MousePointerClick size={20} />, title: 'Sélection visuelle', text: 'Désignez vous-même les titres, liens et dates d’un clic sur la page.' },
    { kind: 'watch' as const, icon: <Eye size={20} />, title: 'Surveiller les changements', text: 'Recevez un article dès qu’une zone de la page change.' },
    { kind: 'json' as const, icon: <Braces size={20} />, title: 'API JSON', text: 'Pour une adresse qui renvoie des données JSON.' },
    { kind: 'feed' as const, icon: <Merge size={20} />, title: 'Filtrer ou fusionner des flux', text: 'Partez de flux existants et gardez seulement ce qui compte.' },
  ];
  return (
    <div className="tool-grid">
      {tools.map((t) => (
        <button key={t.kind} type="button" className="tool-card" onClick={() => onPick(t.kind)}>
          <span className="tool-icon">{t.icon}</span>
          <span className="tool-title">{t.title}</span>
          <span className="tool-text">{t.text}</span>
        </button>
      ))}
    </div>
  );
}

function Results({ url, data, onRender, open }: { url: string; data: AnalyzeResult; onRender: () => void; open: (draft: FeedInput) => void }) {
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.settings, staleTime: 60_000 });
  const refresh = settings.data?.defaultRefreshMinutes ?? 60;
  const navigate = useNavigate();
  const feedsFound = data.existingFeeds;
  const jsonCandidates = data.json?.candidates ?? [];

  const openTool = (kind: 'html' | 'watch' | 'json' | 'feed') => {
    if (kind === 'html') open(htmlDraft(url, data, undefined, refresh));
    else if (kind === 'watch') open(watchDraft(url, data, refresh));
    else if (kind === 'json') open(jsonDraft(url, data, undefined, refresh));
    else open(feedDraft(feedsFound.map((f) => f.url).slice(0, 1), null, data, refresh));
  };

  return (
    <div className="results">
      {data.hints.redirectWall && (
        <div className="callout callout-warn">
          <TriangleAlert size={18} aria-hidden />
          <div className="callout-body">
            <p>
              <strong>Cette adresse renvoie vers une page de consentement ou de connexion ({data.hints.redirectWall}).</strong>{' '}
              {!data.hints.rendered && data.hints.browserAvailable
                ? 'Avec le rendu JavaScript, Glaneur répond lui-même aux bandeaux de cookies.'
                : 'Glaneur voit cette page à la place du contenu. Pour y accéder, copiez les cookies de votre navigateur pour ce site dans le champ « Cookies » des réglages du flux.'}
            </p>
            {!data.hints.rendered && data.hints.browserAvailable && (
              <Button size="sm" icon={<RotateCw size={14} />} onClick={onRender}>
                Analyser avec le rendu JavaScript
              </Button>
            )}
          </div>
        </div>
      )}
      {data.recipes.map((match) => (
        <section key={match.recipeId} className="result-banner card">
          <span className="result-banner-icon">
            <BrandIcon name={match.recipeId} size={22} />
          </span>
          <div className="result-banner-text">
            <p className="result-banner-title">{match.label} : une recette est prête</p>
            <p className="faint">Elle crée le flux sans avoir à désigner les éléments de la page.</p>
          </div>
          <Button
            variant="primary"
            onClick={() => navigate(`/recipes?open=${match.recipeId}&params=${encodeURIComponent(JSON.stringify(match.params))}`)}
          >
            Utiliser la recette <ArrowRight size={16} aria-hidden />
          </Button>
        </section>
      ))}

      {data.kind === 'feed' && (
        <section className="result-banner card">
          <span className="result-banner-icon">
            <BrandIcon name="rss" size={22} />
          </span>
          <div className="result-banner-text">
            <p className="result-banner-title">Cette adresse est déjà un flux</p>
            <p className="faint">
              {data.feed?.title ?? 'Flux'} · {plural(data.feed?.itemCount ?? 0, 'article', 'articles')}. Ajoutez-le pour le filtrer, le fusionner ou récupérer le texte
              complet des articles.
            </p>
          </div>
          <Button variant="primary" onClick={() => open(feedDraft([data.finalUrl], data.feed?.title, data, refresh))}>
            Ajouter à Glaneur <ArrowRight size={16} aria-hidden />
          </Button>
        </section>
      )}

      {data.kind === 'html' && feedsFound.length > 0 && (
        <section className="section-block">
          <div className="section-head">
            <h2 className="display section-title">Ce site publie déjà un flux</h2>
            <p className="faint">Vous pouvez vous y abonner directement, ou l’ajouter à Glaneur pour le filtrer.</p>
          </div>
          <ul className="existing-feeds card">
            {feedsFound.map((f) => (
              <li key={f.url}>
                <Badge tone="ink">{f.format.toUpperCase()}</Badge>
                <span className="existing-feed-text">
                  <span className="existing-feed-title">{f.title ?? 'Flux sans titre'}</span>
                  <span className="mono faint truncate">{f.url}</span>
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<Copy size={14} />}
                  onClick={() => void copyText(f.url)}
                >
                  Copier
                </Button>
                <Button size="sm" onClick={() => open(feedDraft([f.url], f.title, data, refresh))}>
                  Ajouter et filtrer
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {data.hints.needsRender && !data.hints.redirectWall && (
        <div className="callout callout-warn">
          <TriangleAlert size={18} aria-hidden />
          <div className="callout-body">
            <p>
              <strong>Cette page semble construite en JavaScript.</strong>{' '}
              {data.hints.browserAvailable
                ? 'Relancez l’analyse avec le rendu JavaScript pour voir son contenu réel.'
                : 'Le rendu JavaScript nécessite Chromium sur le serveur (voir la documentation d’installation).'}
            </p>
            {data.hints.browserAvailable && (
              <Button size="sm" icon={<RotateCw size={14} />} onClick={onRender}>
                Analyser avec le rendu JavaScript
              </Button>
            )}
          </div>
        </div>
      )}

      {data.candidates.length > 0 && (
        <section className="section-block">
          <div className="section-head">
            <h2 className="display section-title">Listes repérées sur la page</h2>
            <p className="faint">Choisissez celle qui contient les articles à suivre. Vous pourrez ajuster chaque champ ensuite.</p>
          </div>
          <div className="candidate-grid">
            {data.candidates.map((c, i) => (
              <article key={c.itemSelector} className={`candidate card ${i === 0 ? 'is-best' : ''}`}>
                <header className="candidate-head">
                  <span className="candidate-count">{plural(c.count, 'élément', 'éléments')}</span>
                  {i === 0 && (
                    <Badge tone="ink">
                      <Sparkles size={12} aria-hidden /> Meilleure piste
                    </Badge>
                  )}
                </header>
                <code className="candidate-selector truncate" title={c.itemSelector}>
                  {c.itemSelector}
                </code>
                <SampleList items={c.sample} />
                <FieldChips fields={c.fields} />
                <Button variant={i === 0 ? 'primary' : 'secondary'} className="candidate-action" onClick={() => open(htmlDraft(url, data, c, refresh))}>
                  Utiliser cette liste <ArrowRight size={16} aria-hidden />
                </Button>
              </article>
            ))}
          </div>
        </section>
      )}

      {jsonCandidates.length > 0 && (
        <section className="section-block">
          <div className="section-head">
            <h2 className="display section-title">{data.kind === 'json' ? 'Listes trouvées dans le JSON' : 'Données JSON intégrées à la page'}</h2>
            <p className="faint">Glaneur a repéré des listes d’objets et deviné les champs.</p>
          </div>
          <div className="candidate-grid">
            {jsonCandidates.map((c, i) => (
              <article key={c.itemsPath} className={`candidate card ${i === 0 ? 'is-best' : ''}`}>
                <header className="candidate-head">
                  <span className="candidate-count">{plural(c.count, 'objet', 'objets')}</span>
                </header>
                <code className="candidate-selector truncate">{c.itemsPath || '(racine)'}</code>
                <SampleList items={c.sample} />
                <FieldChips fields={c.fields} />
                <Button variant={i === 0 ? 'primary' : 'secondary'} className="candidate-action" onClick={() => open(jsonDraft(url, data, c, refresh))}>
                  Utiliser ces données <ArrowRight size={16} aria-hidden />
                </Button>
              </article>
            ))}
          </div>
        </section>
      )}

      {data.kind === 'html' && data.candidates.length === 0 && !data.hints.needsRender && (
        <p className="callout">Aucune liste d’articles évidente sur cette page. Désignez les éléments vous-même avec la sélection visuelle.</p>
      )}

      <section className="section-block">
        <div className="section-head">
          <h2 className="display section-title">Autres façons de créer le flux</h2>
        </div>
        <ToolCards onPick={openTool} />
      </section>
    </div>
  );
}

export function NewFeed() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const url = params.get('url') ?? '';
  const render = params.get('render') === '1';
  const [input, setInput] = useState(url);
  useEffect(() => setInput(url), [url]);

  const analysis = useQuery({
    queryKey: ['analyze', url, render],
    queryFn: () => api.analyze(url, render),
    enabled: !!url,
    staleTime: 5 * 60_000,
    retry: false,
  });
  useDocumentTitle(url ? `Analyse de ${domainOf(url)}` : 'Nouveau flux');

  const open = (draft: FeedInput) => navigate('/editor', { state: { draft } });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (input.trim()) setParams({ url: input.trim() });
  };

  const data = analysis.data;
  return (
    <div className="new-feed">
      <Link to="/" className="back-link">
        <ArrowLeft size={16} aria-hidden /> Vos flux
      </Link>

      <header className="new-head">
        <div className="new-target">
          {data ? <FeedIcon src={data.iconUrl} name={data.title ?? domainOf(url)} size={48} /> : null}
          <div className="new-target-text">
            <p className="eyebrow">{url ? 'Nouveau flux' : 'Créer un flux'}</p>
            <h1 className="display page-title">{url ? (data?.title ?? domainOf(url)) : 'Quelle page suivre ?'}</h1>
            {data && (
              <a className="mono faint truncate new-target-url" href={data.finalUrl} target="_blank" rel="noreferrer noopener">
                {data.finalUrl}
              </a>
            )}
          </div>
        </div>
        <form className="new-form" onSubmit={submit}>
          <input className="input mono" type="text" inputMode="url" spellCheck={false} aria-label="Adresse de la page" placeholder="https://exemple.fr/actualites" value={input} onChange={(e) => setInput(e.target.value)} />
          <Button type="submit" disabled={!input.trim()}>
            Analyser
          </Button>
        </form>
      </header>

      {!url && (
        <section className="section-block">
          <div className="section-head">
            <h2 className="display section-title">Ou partez d’un outil</h2>
          </div>
          <ToolCards onPick={(kind) => navigate('/editor', { state: { draft: kind === 'html' ? htmlDraft('') : kind === 'watch' ? watchDraft('') : kind === 'json' ? jsonDraft('') : feedDraft([]) } })} />
        </section>
      )}

      {url && analysis.isFetching && <Analyzing url={url} />}

      {url && analysis.isError && !analysis.isFetching && (
        <div className="analysis-error card">
          <p className="display analysis-error-title">Impossible de lire cette page</p>
          <p className="callout callout-error">{analysis.error.message}</p>
          <div className="analysis-error-actions">
            <Button icon={<RotateCw size={16} />} onClick={() => void analysis.refetch()}>
              Réessayer
            </Button>
            {!render && (
              <Button onClick={() => setParams({ url, render: '1' })}>Réessayer avec le rendu JavaScript</Button>
            )}
            <Button variant="ghost" onClick={() => open(htmlDraft(url))}>
              Ouvrir la sélection visuelle
            </Button>
          </div>
        </div>
      )}

      {url && data && !analysis.isFetching && <Results url={url} data={data} open={open} onRender={() => setParams({ url, render: '1' })} />}
    </div>
  );
}
