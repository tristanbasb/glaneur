import { useQuery } from '@tanstack/react-query';
import { Plus, X } from 'lucide-react';
import type { Dispatch, SetStateAction } from 'react';
import type { FeedInput, FeedOptions, FilterRule, RenderOptions, RequestOptions } from '../../shared/types';
import { Button, Field, IconButton, Input, Select, Textarea, Toggle } from '../components/ui';
import { api } from '../lib/api';
import { REFRESH_CHOICES } from '../lib/fields';

function slugPreview(value: string): string {
  return (
    value
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'flux'
  );
}

function FilterRow({ rule, onChange, onRemove }: { rule: FilterRule; onChange: (r: FilterRule) => void; onRemove: () => void }) {
  return (
    <div className="filter-row">
      <Select aria-label="Action" value={rule.mode} onChange={(e) => onChange({ ...rule, mode: e.target.value as FilterRule['mode'] })}>
        <option value="exclude">Exclure</option>
        <option value="include">Garder</option>
      </Select>
      <Select aria-label="Champ" value={rule.field} onChange={(e) => onChange({ ...rule, field: e.target.value as FilterRule['field'] })}>
        <option value="any">si le texte</option>
        <option value="title">si le titre</option>
        <option value="content">si le contenu</option>
        <option value="link">si le lien</option>
        <option value="author">si l’auteur</option>
      </Select>
      <Input
        aria-label="Motif"
        className={rule.regex ? 'mono' : ''}
        placeholder={rule.regex ? 'expression régulière' : 'contient…'}
        value={rule.pattern}
        onChange={(e) => onChange({ ...rule, pattern: e.target.value })}
      />
      <IconButton label="Supprimer ce filtre" onClick={onRemove}>
        <X size={16} />
      </IconButton>
      <label className="filter-regex">
        <input type="checkbox" checked={!!rule.regex} onChange={(e) => onChange({ ...rule, regex: e.target.checked })} /> expression régulière
      </label>
    </div>
  );
}

export function OptionsPanel({ draft, setDraft }: { draft: FeedInput; setDraft: Dispatch<SetStateAction<FeedInput>> }) {
  const system = useQuery({ queryKey: ['system'], queryFn: api.system, staleTime: 60_000 });
  const opts = draft.options;
  const src = draft.source;
  const setInput = (patch: Partial<FeedInput>) => setDraft((d) => ({ ...d, ...patch }));
  const setOpt = (patch: Partial<FeedOptions>) => setDraft((d) => ({ ...d, options: { ...d.options, ...patch } }));
  const setReq = (patch: Partial<RequestOptions>) => setDraft((d) => ({ ...d, options: { ...d.options, request: { ...d.options.request, ...patch } } }));
  const setRender = (patch: Partial<RenderOptions>) =>
    setDraft((d) => (d.source.type === 'html' || d.source.type === 'watch' ? { ...d, source: { ...d.source, render: { ...d.source.render, ...patch } } } : d));
  const setFilters = (filters: FilterRule[]) => setOpt({ filters });

  const customRefresh = !REFRESH_CHOICES.some((c) => c.value === opts.refreshMinutes);
  const headers = Object.entries(opts.request.headers ?? {});
  const setHeaders = (entries: Array<[string, string]>) => setReq({ headers: Object.fromEntries(entries) });
  const browserAvailable = system.data?.browser.available ?? true;

  return (
    <div className="options">
      <section className="panel-section">
        <h3 className="panel-section-title">Général</h3>
        <Field label="Nom" htmlFor="opt-name">
          <Input id="opt-name" value={draft.name} onChange={(e) => setInput({ name: e.target.value })} />
        </Field>
        <Field label="Identifiant dans l’adresse" htmlFor="opt-slug" hint={<span className="mono">/f/{slugPreview(draft.slug || draft.name)}.rss</span>}>
          <Input id="opt-slug" className="mono" placeholder={slugPreview(draft.name)} value={draft.slug ?? ''} onChange={(e) => setInput({ slug: e.target.value })} />
        </Field>
        <Field label="Description" htmlFor="opt-description">
          <Textarea id="opt-description" rows={2} value={draft.description ?? ''} onChange={(e) => setInput({ description: e.target.value })} />
        </Field>
        <div className="settings-grid">
          <Field label="Adresse du site" htmlFor="opt-site">
            <Input id="opt-site" className="mono" value={draft.siteUrl ?? ''} onChange={(e) => setInput({ siteUrl: e.target.value })} />
          </Field>
          <Field label="Icône" htmlFor="opt-icon">
            <Input id="opt-icon" className="mono" placeholder="automatique" value={draft.iconUrl ?? ''} onChange={(e) => setInput({ iconUrl: e.target.value })} />
          </Field>
        </div>
        <Toggle checked={draft.enabled} onChange={(v) => setInput({ enabled: v })} label="Flux actif" description="En pause, le flux reste lisible mais n’est plus actualisé." />
      </section>

      <section className="panel-section">
        <h3 className="panel-section-title">Actualisation</h3>
        <div className="settings-grid">
          <Field label="Fréquence" htmlFor="opt-refresh">
            <Select
              id="opt-refresh"
              value={customRefresh ? 'custom' : String(opts.refreshMinutes)}
              onChange={(e) => setOpt({ refreshMinutes: e.target.value === 'custom' ? 90 : Number(e.target.value) })}
            >
              {REFRESH_CHOICES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
              <option value="custom">Personnalisée…</option>
            </Select>
          </Field>
          {customRefresh ? (
            <Field label="Minutes" htmlFor="opt-refresh-min">
              <Input id="opt-refresh-min" type="number" min={5} max={10080} value={opts.refreshMinutes} onChange={(e) => setOpt({ refreshMinutes: Number(e.target.value) || 5 })} />
            </Field>
          ) : (
            <Field label="Articles dans le flux" htmlFor="opt-max">
              <Input id="opt-max" type="number" min={1} max={500} value={opts.maxItems} onChange={(e) => setOpt({ maxItems: Number(e.target.value) || 1 })} />
            </Field>
          )}
        </div>
        {customRefresh && (
          <Field label="Articles dans le flux" htmlFor="opt-max-2">
            <Input id="opt-max-2" type="number" min={1} max={500} value={opts.maxItems} onChange={(e) => setOpt({ maxItems: Number(e.target.value) || 1 })} />
          </Field>
        )}
      </section>

      <section className="panel-section">
        <div className="panel-section-head">
          <h3 className="panel-section-title">Filtres</h3>
          <Button size="sm" variant="ghost" icon={<Plus size={14} />} onClick={() => setFilters([...opts.filters, { mode: 'exclude', field: 'title', pattern: '', regex: false }])}>
            Ajouter un filtre
          </Button>
        </div>
        {opts.filters.length === 0 ? (
          <p className="panel-note">Aucun filtre : tous les articles trouvés sont gardés.</p>
        ) : (
          <div className="filters">
            {opts.filters.map((rule, i) => (
              <FilterRow
                key={i}
                rule={rule}
                onChange={(r) => setFilters(opts.filters.map((x, j) => (j === i ? r : x)))}
                onRemove={() => setFilters(opts.filters.filter((_, j) => j !== i))}
              />
            ))}
            <p className="panel-note">Les accents et la casse sont ignorés. « Garder » conserve les articles qui correspondent à au moins un de ces filtres.</p>
          </div>
        )}
      </section>

      {src.type !== 'watch' && (
        <section className="panel-section">
          <h3 className="panel-section-title">Texte complet</h3>
          <Toggle
            checked={opts.fullText.enabled}
            onChange={(v) => setOpt({ fullText: { ...opts.fullText, enabled: v } })}
            label="Récupérer le texte complet des articles"
            description="Glaneur ouvre chaque nouvel article et en garde le contenu principal."
          />
          {opts.fullText.enabled && (
            <Field label="Sélecteur du contenu" htmlFor="opt-fulltext" hint="Facultatif : laissez vide pour la détection automatique.">
              <Input id="opt-fulltext" className="mono" placeholder="article .entry-content" value={opts.fullText.selector ?? ''} onChange={(e) => setOpt({ fullText: { ...opts.fullText, selector: e.target.value } })} />
            </Field>
          )}
        </section>
      )}

      {(src.type === 'html' || src.type === 'watch') && (
        <section className="panel-section">
          <h3 className="panel-section-title">Rendu JavaScript</h3>
          <Toggle
            checked={src.render.enabled}
            disabled={!browserAvailable && !src.render.enabled}
            onChange={(v) => setRender({ enabled: v })}
            label="Afficher la page avec Chromium"
            description={browserAvailable ? 'Pour les sites construits en JavaScript. Plus lent et plus gourmand.' : 'Chromium n’est pas installé sur le serveur.'}
          />
          {src.render.enabled && (
            <>
              <Field label="Attendre l’élément" htmlFor="opt-wait" hint="Facultatif : un sélecteur qui apparaît quand la liste est chargée.">
                <Input id="opt-wait" className="mono" placeholder=".article-list" value={src.render.waitFor ?? ''} onChange={(e) => setRender({ waitFor: e.target.value || undefined })} />
              </Field>
              <Toggle checked={!!src.render.scroll} onChange={(v) => setRender({ scroll: v || undefined })} label="Faire défiler la page" description="Charge les contenus qui n’apparaissent qu’au défilement." />
              <Field label="Délai supplémentaire (ms)" htmlFor="opt-delay">
                <Input id="opt-delay" type="number" min={0} max={15000} step={250} value={src.render.delayMs ?? 0} onChange={(e) => setRender({ delayMs: Number(e.target.value) || undefined })} />
              </Field>
            </>
          )}
        </section>
      )}

      <section className="panel-section">
        <h3 className="panel-section-title">Requête</h3>
        <Field label="User-Agent" htmlFor="opt-ua" hint="Vide : celui des réglages généraux.">
          <Input id="opt-ua" className="mono" value={opts.request.userAgent ?? ''} onChange={(e) => setReq({ userAgent: e.target.value || undefined })} />
        </Field>
        <Field label="Cookies" htmlFor="opt-cookies" hint="Format « nom=valeur; autre=valeur », pour les pages qui exigent une session.">
          <Textarea id="opt-cookies" className="mono" rows={2} value={opts.request.cookies ?? ''} onChange={(e) => setReq({ cookies: e.target.value || undefined })} />
        </Field>
        <div className="panel-section-head">
          <span className="field-label">En-têtes HTTP</span>
          <Button size="sm" variant="ghost" icon={<Plus size={14} />} onClick={() => setHeaders([...headers, ['', '']])}>
            Ajouter
          </Button>
        </div>
        {headers.map(([name, value], i) => (
          <div key={i} className="kv-row">
            <Input className="mono" aria-label="Nom de l’en-tête" placeholder="Authorization" value={name} onChange={(e) => setHeaders(headers.map((h, j) => (j === i ? [e.target.value, h[1]] : h)))} />
            <Input className="mono" aria-label="Valeur" value={value} onChange={(e) => setHeaders(headers.map((h, j) => (j === i ? [h[0], e.target.value] : h)))} />
            <IconButton label="Supprimer cet en-tête" onClick={() => setHeaders(headers.filter((_, j) => j !== i))}>
              <X size={16} />
            </IconButton>
          </div>
        ))}
        <Field label="Délai maximal (secondes)" htmlFor="opt-timeout">
          <Input id="opt-timeout" type="number" min={5} max={120} placeholder="25" value={opts.request.timeoutSec ?? ''} onChange={(e) => setReq({ timeoutSec: e.target.value ? Number(e.target.value) : undefined })} />
        </Field>
      </section>
    </div>
  );
}
