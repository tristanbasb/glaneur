import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Monitor, RotateCw, Smartphone } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import type { FeedDetail, FeedInput, FieldKey, HtmlSource, JsonSource, SourceConfig, WatchSource } from '../../shared/types';
import { FeedIcon } from '../components/FeedIcon';
import { ThemeToggle } from '../components/Layout';
import { Badge, Button, IconButton, Input, Segmented, Spinner, Toggle } from '../components/ui';
import { FieldsPanel } from '../editor/FieldsPanel';
import { parsePath, pathToString, type JsonPath } from '../editor/JsonExplorer';
import { OptionsPanel } from '../editor/OptionsPanel';
import { Palette } from '../editor/Palette';
import { PreviewPanel } from '../editor/PreviewPanel';
import { FeedSourcesPanel, JsonSourcePanel, JsonStage, WatchPanel } from '../editor/SourcePanels';
import { api } from '../lib/api';
import { FIELD_META, SOURCE_LABELS } from '../lib/fields';
import { plural } from '../lib/format';
import { useDebounced, useDocumentTitle } from '../lib/hooks';
import type { EngineMode, EngineState, EngineStats, PickResult } from '../picker/engine';
import { type PickerHandle, VisualPicker } from '../picker/VisualPicker';

function toInput(f: FeedDetail): FeedInput {
  return { name: f.name, slug: f.slug, description: f.description, siteUrl: f.siteUrl, iconUrl: f.iconUrl, enabled: f.enabled, recipe: f.recipe, source: f.source, options: f.options };
}

function cleanSource(source: SourceConfig): SourceConfig {
  if (source.type === 'feed') return { ...source, urls: source.urls.map((u) => u.trim()).filter(Boolean) };
  return { ...source, url: source.url.trim() } as SourceConfig;
}

function previewable(source: SourceConfig): boolean {
  switch (source.type) {
    case 'html':
      return !!source.url.trim() && !!source.itemSelector.trim();
    case 'feed':
      return source.urls.some((u) => u.trim());
    default:
      return !!source.url.trim();
  }
}

function saveProblem(draft: FeedInput): string | null {
  if (!draft.name.trim()) return 'Donnez un nom au flux.';
  const s = draft.source;
  if (s.type === 'feed') return s.urls.some((u) => u.trim()) ? null : 'Ajoutez au moins un flux source.';
  if (!s.url.trim()) return 'Indiquez l’adresse de la page.';
  if (s.type === 'html' && !s.itemSelector.trim()) return 'Désignez l’élément qui se répète dans la page.';
  return null;
}

const NOT_READY: Record<SourceConfig['type'], string> = {
  html: 'Désignez un élément de la liste dans la page (ou saisissez son sélecteur) pour voir l’aperçu.',
  json: 'Indiquez l’adresse de l’API pour voir l’aperçu.',
  feed: 'Ajoutez l’adresse d’un flux pour voir l’aperçu.',
  watch: 'Indiquez l’adresse de la page pour voir l’aperçu.',
};

export function EditorPage() {
  const { id } = useParams();
  const location = useLocation();
  const existing = useQuery({ queryKey: ['feed', id], queryFn: () => api.feed(id!), enabled: !!id });
  const stateDraft = (location.state as { draft?: FeedInput } | null)?.draft ?? null;

  if (id) {
    if (existing.isPending) {
      return (
        <div className="boot">
          <Spinner />
        </div>
      );
    }
    if (existing.isError) {
      return (
        <div className="boot">
          <p className="display boot-title">Flux introuvable</p>
          <Link to="/" className="btn btn-secondary">
            Retour à vos flux
          </Link>
        </div>
      );
    }
    return <Editor key={id} feedId={id} initial={toInput(existing.data)} />;
  }
  if (!stateDraft) return <Navigate to="/new" replace />;
  return <Editor key={location.key} feedId={null} initial={stateDraft} />;
}

function Editor({ feedId, initial }: { feedId: string | null; initial: FeedInput }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [draft, setDraft] = useState<FeedInput>(initial);
  const [tab, setTab] = useState<'fields' | 'options'>('fields');
  const [mode, setMode] = useState<EngineMode>(initial.source.type === 'html' && !initial.source.itemSelector ? 'item' : null);
  const [stats, setStats] = useState<EngineStats>({ items: 0, fields: {}, region: 0 });
  const [width, setWidth] = useState<'desktop' | 'mobile'>('desktop');
  const [reloadKey, setReloadKey] = useState(0);
  const [jsonField, setJsonField] = useState<FieldKey | null>(null);
  const pickerRef = useRef<PickerHandle>(null);
  const source = draft.source;
  const [urlInput, setUrlInput] = useState(source.type === 'feed' ? '' : source.url);

  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  useDocumentTitle(feedId ? `Modifier · ${draft.name}` : 'Nouveau flux');

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMode(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  function patchSource<T extends SourceConfig>(patch: Partial<T>) {
    setDraft((d) => ({ ...d, source: { ...d.source, ...patch } as SourceConfig }));
  }

  // ---- Preview ----
  const payload = JSON.stringify({ source: cleanSource(source), filters: draft.options.filters, request: draft.options.request });
  const settled = useDebounced(payload, 650);
  const ready = previewable(source);
  const preview = useQuery({
    queryKey: ['preview', settled],
    queryFn: () => {
      const p = JSON.parse(settled) as { source: SourceConfig; filters: FeedInput['options']['filters']; request: FeedInput['options']['request'] };
      return api.preview(p.source, { ...draft.options, filters: p.filters, request: p.request });
    },
    enabled: ready && previewable((JSON.parse(settled) as { source: SourceConfig }).source),
    retry: false,
    staleTime: 5 * 60_000,
    placeholderData: keepPreviousData,
  });
  const reload = useMutation({
    mutationFn: () => api.preview(cleanSource(source), draft.options, true),
    onSuccess: (data) => qc.setQueryData(['preview', payload], data),
    onError: (err) => toast.error(err.message),
  });

  // ---- Visual selection ----
  const engineState = useMemo<EngineState>(() => {
    if (source.type === 'html') return { mode, itemSelector: source.itemSelector, fields: source.fields, region: '' };
    if (source.type === 'watch') return { mode, itemSelector: '', fields: {}, region: source.selector };
    return { mode: null, itemSelector: '', fields: {}, region: '' };
  }, [mode, source]);

  const applyItem = (itemSelector: string, count: number) => {
    if (source.type !== 'html') return;
    const fields = source.itemSelector.trim() && Object.keys(source.fields).length ? (pickerRef.current?.rebase(source.itemSelector, itemSelector, source.fields) ?? source.fields) : source.fields;
    patchSource<HtmlSource>({ itemSelector, fields });
    toast.success(`${plural(count, 'élément repéré', 'éléments repérés')}`);
  };

  const handlePick = (r: PickResult) => {
    if (r.kind === 'error') {
      toast.error(r.message);
      return;
    }
    if (r.kind === 'region') {
      if (source.type === 'watch') patchSource<WatchSource>({ selector: r.selector });
      setMode(null);
      return;
    }
    if (source.type !== 'html') return;
    if (r.kind === 'item') {
      applyItem(r.itemSelector, r.count);
      if (!source.fields.title) setMode('title');
      return;
    }
    let fields = source.fields;
    let itemSelector = source.itemSelector;
    if (r.itemSelector && r.itemSelector !== source.itemSelector) {
      if (source.itemSelector.trim() && Object.keys(fields).length) fields = pickerRef.current?.rebase(source.itemSelector, r.itemSelector, fields) ?? fields;
      itemSelector = r.itemSelector;
    }
    patchSource<HtmlSource>({ itemSelector, fields: { ...fields, [r.field]: r.rule } });
    toast.success(`${FIELD_META[r.field].label} : ${r.rule.selector}`, { duration: 2200 });
  };

  const changeItemLevel = (r: PickResult | null | undefined) => {
    if (!r) return;
    if (r.kind === 'error') toast.error(r.message);
    else if (r.kind === 'item') applyItem(r.itemSelector, r.count);
  };

  const commitUrl = () => {
    if (source.type === 'feed') return;
    const value = urlInput.trim();
    if (value !== source.url) patchSource({ url: value });
  };

  // ---- JSON explorer ----
  const pickJsonList = (path: string) => {
    if (source.type !== 'json') return;
    patchSource<JsonSource>({ itemsPath: path });
    if (!jsonField) setJsonField('title');
  };
  const pickJsonValue = (path: JsonPath) => {
    if (source.type !== 'json') return;
    if (!jsonField) {
      toast('Choisissez d’abord le champ à remplir (Titre, Lien…) à droite.');
      return;
    }
    const base = parsePath(source.itemsPath);
    const inside = base.every((p, i) => path[i] === p) && typeof path[base.length] === 'number' && path.length > base.length + 1;
    if (!inside) {
      toast.error('Choisissez une valeur à l’intérieur d’un élément de la liste.');
      return;
    }
    const relative = pathToString(path.slice(base.length + 1));
    patchSource<JsonSource>({ fields: { ...source.fields, [jsonField]: relative } });
    toast.success(`${FIELD_META[jsonField].label} : ${relative}`);
  };

  // ---- Save ----
  const problem = saveProblem(draft);
  const save = useMutation({
    mutationFn: () => {
      const input = { ...draft, name: draft.name.trim(), source: cleanSource(draft.source) };
      return feedId ? api.updateFeed(feedId, input) : api.createFeed(input);
    },
    onSuccess: (feed) => {
      void qc.invalidateQueries({ queryKey: ['feeds'] });
      qc.setQueryData(['feed', feed.id], feed);
      toast.success(feedId ? 'Modifications enregistrées' : `« ${feed.name} » est créé`);
      navigate(`/feeds/${feed.id}`, { replace: true });
    },
    onError: (err) => toast.error(err.message),
  });

  const previewPanel = (
    <PreviewPanel query={preview} sourceType={source.type} ready={ready} notReady={NOT_READY[source.type]} onReload={() => reload.mutate()} reloading={reload.isPending} />
  );

  const header = (
    <header className="editor-bar">
      <Link to={feedId ? `/feeds/${feedId}` : '/new'} className="icon-btn" aria-label="Quitter l’éditeur" title="Quitter l’éditeur">
        <ArrowLeft size={18} />
      </Link>
      <FeedIcon src={draft.iconUrl} name={draft.name || '?'} size={28} />
      <input className="editor-name display" aria-label="Nom du flux" placeholder="Nom du flux" value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />
      <Badge>{SOURCE_LABELS[source.type]}</Badge>
      {dirty && <span className="editor-dirty">Non enregistré</span>}
      <div className="editor-bar-actions">
        <ThemeToggle />
        <Button variant="primary" loading={save.isPending} disabled={!!problem} title={problem ?? undefined} onClick={() => save.mutate()}>
          {feedId ? 'Enregistrer' : 'Créer le flux'}
        </Button>
      </div>
    </header>
  );

  const tabs = (labels: [string, string]) => (
    <div className="panel-tabs" role="tablist">
      {(['fields', 'options'] as const).map((t, i) => (
        <button key={t} type="button" role="tab" aria-selected={tab === t} className={`panel-tab ${tab === t ? 'is-active' : ''}`} onClick={() => setTab(t)}>
          {labels[i]}
        </button>
      ))}
    </div>
  );

  if (source.type === 'feed') {
    return (
      <div className="editor">
        {header}
        <div className="editor-split">
          <section className="editor-stage is-panel">
            <div className="panel-body">
              <FeedSourcesPanel source={source} onChange={(urls) => patchSource({ urls })} />
              {previewPanel}
            </div>
          </section>
          <aside className="editor-panel">
            <div className="panel-body">
              <OptionsPanel draft={draft} setDraft={setDraft} />
            </div>
          </aside>
        </div>
      </div>
    );
  }

  const renderEnabled = source.type === 'json' ? false : source.render.enabled;

  return (
    <div className="editor">
      {header}
      <div className="editor-split">
        <section className="editor-stage">
          {source.type === 'json' ? (
            <>
              <div className="stage-toolbar">
                <span className="stage-title">Données JSON</span>
                <span className="palette-hint">{jsonField ? `Cliquez sur la valeur à utiliser pour « ${FIELD_META[jsonField].label} »` : 'Choisissez « Utiliser comme liste » sur le tableau des articles'}</span>
              </div>
              <div className="stage-scroll">
                <JsonStage source={source} options={draft.options} onUseList={pickJsonList} onUseValue={pickJsonValue} />
              </div>
            </>
          ) : (
            <>
              <div className="stage-toolbar">
                <form
                  className="stage-url"
                  onSubmit={(e) => {
                    e.preventDefault();
                    commitUrl();
                  }}
                >
                  <Input className="mono" aria-label="Adresse de la page" placeholder="https://exemple.fr/actualites" spellCheck={false} value={urlInput} onChange={(e) => setUrlInput(e.target.value)} onBlur={commitUrl} />
                </form>
                <IconButton label="Relire la page" onClick={() => {
                  setReloadKey((k) => k + 1);
                  if (ready) reload.mutate();
                }}>
                  <RotateCw size={17} className={reload.isPending ? 'spin' : ''} />
                </IconButton>
                <Segmented
                  size="sm"
                  label="Largeur d’affichage"
                  value={width}
                  onChange={setWidth}
                  options={[
                    { value: 'desktop', label: <Monitor size={15} aria-label="Bureau" />, title: 'Largeur bureau' },
                    { value: 'mobile', label: <Smartphone size={15} aria-label="Mobile" />, title: 'Largeur mobile' },
                  ]}
                />
                <div className="stage-render">
                  <Toggle checked={renderEnabled} onChange={(v) => setDraft((d) => (d.source.type === 'html' || d.source.type === 'watch' ? { ...d, source: { ...d.source, render: { scroll: v, ...d.source.render, enabled: v } } } : d))} label="JavaScript" />
                </div>
              </div>
              <Palette variant={source.type === 'watch' ? 'watch' : 'html'} mode={mode} onMode={setMode} stats={stats} />
              <VisualPicker
                ref={pickerRef}
                url={source.url}
                render={source.render}
                request={draft.options.request}
                state={engineState}
                width={width}
                reloadKey={reloadKey}
                onPick={handlePick}
                onStats={setStats}
                onEscape={() => setMode(null)}
              />
            </>
          )}
        </section>

        <aside className="editor-panel">
          {tabs([source.type === 'watch' ? 'Surveillance' : 'Extraction', 'Réglages'])}
          <div className="panel-body">
            {tab === 'fields' ? (
              <>
                {source.type === 'html' && (
                  <FieldsPanel
                    source={source}
                    onChange={(patch) => patchSource<HtmlSource>(patch)}
                    stats={stats}
                    mode={mode}
                    onMode={setMode}
                    onWiden={() => changeItemLevel(pickerRef.current?.widen())}
                    onNarrow={() => changeItemLevel(pickerRef.current?.narrow())}
                  />
                )}
                {source.type === 'watch' && (
                  <WatchPanel
                    source={source}
                    onChange={(patch) => patchSource<WatchSource>(patch)}
                    mode={mode}
                    onMode={setMode}
                    stats={stats}
                    onWiden={() => {
                      const r = pickerRef.current?.widenRegion();
                      if (r) handlePick(r);
                    }}
                  />
                )}
                {source.type === 'json' && <JsonSourcePanel source={source} onChange={(patch) => patchSource<JsonSource>(patch)} activeField={jsonField} onActiveField={setJsonField} />}
                {previewPanel}
              </>
            ) : (
              <OptionsPanel draft={draft} setDraft={setDraft} />
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
