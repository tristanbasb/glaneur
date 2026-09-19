import { useQuery } from '@tanstack/react-query';
import { ChevronsUp, Plus, X } from 'lucide-react';
import type { CSSProperties } from 'react';
import type { FeedOptions, FeedSource, FieldKey, JsonSource, SourceConfig, WatchSource } from '../../shared/types';
import { Field, IconButton, Input, Select, Spinner, Textarea, Button } from '../components/ui';
import { api } from '../lib/api';
import { FIELD_META, FIELD_ORDER } from '../lib/fields';
import { useDebounced } from '../lib/hooks';
import type { EngineMode, EngineStats } from '../picker/engine';
import { JsonExplorer, type JsonPath } from './JsonExplorer';

export function JsonSourcePanel({ source, onChange, activeField, onActiveField }: { source: JsonSource; onChange: (patch: Partial<JsonSource>) => void; activeField: FieldKey | null; onActiveField: (key: FieldKey | null) => void }) {
  return (
    <>
      <section className="panel-section">
        <h3 className="panel-section-title">Requête</h3>
        <div className="json-request">
          <Select aria-label="Méthode" value={source.method} onChange={(e) => onChange({ method: e.target.value as JsonSource['method'] })}>
            <option value="GET">GET</option>
            <option value="POST">POST</option>
          </Select>
          <Input className="mono" aria-label="Adresse de l’API" placeholder="https://api.exemple.fr/articles" spellCheck={false} value={source.url} onChange={(e) => onChange({ url: e.target.value })} />
        </div>
        {source.method === 'POST' && (
          <Field label="Corps de la requête" htmlFor="json-body">
            <Textarea id="json-body" className="mono" rows={3} spellCheck={false} value={source.body ?? ''} onChange={(e) => onChange({ body: e.target.value || undefined })} />
          </Field>
        )}
        <Field label="JSON intégré à une page" htmlFor="json-embed" hint="Facultatif : pour lire les données qu’un site place dans sa page, par exemple script#__NEXT_DATA__.">
          <Input id="json-embed" className="mono" placeholder="script#__NEXT_DATA__" spellCheck={false} value={source.embedSelector ?? ''} onChange={(e) => onChange({ embedSelector: e.target.value || undefined })} />
        </Field>
      </section>

      <section className="panel-section">
        <h3 className="panel-section-title">Champs</h3>
        <div className="rule-row rule-row-json">
          <span className="rule-label is-static">
            <span className="pal-swatch is-item" />
            Liste
          </span>
          <Input className="mono rule-input" aria-label="Chemin de la liste" placeholder="data.items (vide : la racine)" spellCheck={false} value={source.itemsPath} onChange={(e) => onChange({ itemsPath: e.target.value })} />
        </div>
        {FIELD_ORDER.map((key) => (
          <div key={key} className="rule-row rule-row-json">
            <button
              type="button"
              className={`rule-label ${activeField === key ? 'is-active' : ''}`}
              style={{ '--mk': FIELD_META[key].color } as CSSProperties}
              onClick={() => onActiveField(activeField === key ? null : key)}
              title="Puis cliquez sur une valeur dans l’arbre"
            >
              <span className="pal-swatch" />
              {FIELD_META[key].label}
            </button>
            <Input
              className="mono rule-input"
              aria-label={`Chemin ${FIELD_META[key].label}`}
              placeholder={key === 'link' ? 'url, ou https://site.fr/{{slug}}' : 'chemin'}
              spellCheck={false}
              value={source.fields[key] ?? ''}
              onChange={(e) => {
                const fields = { ...source.fields };
                if (e.target.value) fields[key] = e.target.value;
                else delete fields[key];
                onChange({ fields });
              }}
            />
          </div>
        ))}
        <p className="panel-note">
          Choisissez un champ puis cliquez sur une valeur du premier élément dans l’arbre. Un modèle comme <code className="mono">{'https://site.fr/{{slug}}'}</code> combine des valeurs.
        </p>
      </section>
    </>
  );
}

export function JsonStage({ source, options, onUseList, onUseValue }: { source: JsonSource; options: FeedOptions; onUseList: (path: string) => void; onUseValue: (path: JsonPath) => void }) {
  const key = JSON.stringify({ url: source.url.trim(), method: source.method, body: source.body, embedSelector: source.embedSelector, request: options.request });
  const settled = useDebounced(key, 600);
  const sample = useQuery({
    queryKey: ['json-sample', settled],
    queryFn: () => {
      const p = JSON.parse(settled) as { url: string; method: 'GET' | 'POST'; body?: string; embedSelector?: string; request: FeedOptions['request'] };
      const src: SourceConfig = { type: 'json', url: p.url, method: p.method, body: p.body, embedSelector: p.embedSelector, itemsPath: '', fields: {} };
      return api.jsonSample(src, { ...options, request: p.request });
    },
    enabled: !!source.url.trim(),
    retry: false,
    staleTime: 5 * 60_000,
  });

  if (!source.url.trim()) return <p className="picker-empty">Indiquez l’adresse de l’API à droite.</p>;
  if (sample.isPending) {
    return (
      <div className="picker-loading is-static">
        <Spinner />
        <span>Lecture du JSON…</span>
      </div>
    );
  }
  if (sample.isError) return <p className="callout callout-error stage-error">{sample.error.message}</p>;
  return <JsonExplorer data={sample.data.data} itemsPath={source.itemsPath} onUseList={onUseList} onUseValue={onUseValue} />;
}

export function FeedSourcesPanel({ source, onChange }: { source: FeedSource; onChange: (urls: string[]) => void }) {
  const urls = source.urls.length ? source.urls : [''];
  return (
    <section className="panel-section">
      <div className="panel-section-head">
        <h3 className="panel-section-title">Flux sources</h3>
        <Button size="sm" variant="ghost" icon={<Plus size={14} />} onClick={() => onChange([...urls, ''])}>
          Ajouter un flux
        </Button>
      </div>
      {urls.map((url, i) => (
        <div key={i} className="kv-row kv-row-wide">
          <Input className="mono" aria-label={`Flux n°${i + 1}`} placeholder="https://exemple.fr/feed.xml" spellCheck={false} value={url} onChange={(e) => onChange(urls.map((u, j) => (j === i ? e.target.value : u)))} />
          <IconButton label="Retirer ce flux" disabled={urls.length === 1} onClick={() => onChange(urls.filter((_, j) => j !== i))}>
            <X size={16} />
          </IconButton>
        </div>
      ))}
      <p className="panel-note">Plusieurs flux sont fusionnés puis triés par date. Ajoutez des filtres dans les réglages pour ne garder que l’essentiel.</p>
    </section>
  );
}

export function WatchPanel({
  source,
  onChange,
  mode,
  onMode,
  stats,
  onWiden,
}: {
  source: WatchSource;
  onChange: (patch: Partial<WatchSource>) => void;
  mode: EngineMode;
  onMode: (m: EngineMode) => void;
  stats: EngineStats;
  onWiden: () => void;
}) {
  const hasZone = !!source.selector.trim();
  return (
    <section className="panel-section">
      <h3 className="panel-section-title">Zone surveillée</h3>
      <div className="rule-row rule-row-item">
        <button
          type="button"
          className={`rule-label ${mode === 'region' ? 'is-active' : ''}`}
          style={{ '--mk': 'var(--m-title)' } as CSSProperties}
          onClick={() => onMode(mode === 'region' ? null : 'region')}
        >
          <span className="pal-swatch" />
          Zone
        </button>
        <Input className="mono rule-input" aria-label="Sélecteur de la zone" placeholder="toute la page" spellCheck={false} value={source.selector} title={source.selector} onChange={(e) => onChange({ selector: e.target.value })} />
        <span className={`rule-count ${hasZone ? (stats.region ? 'is-ok' : 'is-none') : ''}`}>{hasZone ? stats.region : ''}</span>
        <span className="rule-tools">
          <IconButton label="Élargir au bloc parent" onClick={onWiden} disabled={!hasZone}>
            <ChevronsUp size={16} />
          </IconButton>
        </span>
      </div>
      {hasZone && !stats.region && <p className="panel-note is-error">Cette zone est introuvable dans la page affichée.</p>}
      <Field label="Texte à ignorer" htmlFor="watch-ignore" hint="Expression régulière retirée avant la comparaison : compteurs de vues, heure de mise à jour…">
        <Input id="watch-ignore" className="mono" placeholder="\d+ vues|Mis à jour à .*" spellCheck={false} value={source.ignore ?? ''} onChange={(e) => onChange({ ignore: e.target.value || undefined })} />
      </Field>
      <p className="panel-note">À chaque passage, Glaneur compare le texte de la zone et publie un article avec les lignes ajoutées et retirées quand il change.</p>
    </section>
  );
}
