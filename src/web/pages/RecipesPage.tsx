import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import type { RecipeInfo } from '../../shared/types';
import { BrandIcon, brandColor } from '../components/BrandIcon';
import { Button, Dialog, Field, Input, Select, Spinner, Toggle } from '../components/ui';
import { api } from '../lib/api';
import { feedDraft, htmlDraft, jsonDraft, watchDraft } from '../lib/drafts';
import { useDocumentTitle } from '../lib/hooks';
import { ToolCards } from './NewFeed';

type Values = Record<string, string | boolean>;

function initialValues(recipe: RecipeInfo, preset: Values | null): Values {
  return Object.fromEntries(
    recipe.params.map((p) => {
      const fromPreset = preset?.[p.key];
      if (fromPreset !== undefined) return [p.key, fromPreset];
      if (p.default !== undefined) return [p.key, p.default];
      if (p.type === 'checkbox') return [p.key, false];
      if (p.type === 'select') return [p.key, p.options?.[0]?.value ?? ''];
      return [p.key, ''];
    }),
  );
}

function RecipeDialog({ recipe, preset, onClose }: { recipe: RecipeInfo | null; preset: Values | null; onClose: () => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [values, setValues] = useState<Values>({});

  useEffect(() => {
    if (recipe) setValues(initialValues(recipe, preset));
  }, [recipe, preset]);

  const run = useMutation({
    mutationFn: async (mode: 'create' | 'customize') => {
      const { input } = await api.buildRecipe(recipe!.id, values);
      if (mode === 'customize') return { mode, input } as const;
      return { mode, feed: await api.createFeed(input) } as const;
    },
    onSuccess: (r) => {
      if (r.mode === 'customize') {
        navigate('/editor', { state: { draft: r.input } });
        return;
      }
      void qc.invalidateQueries({ queryKey: ['feeds'] });
      toast.success(`« ${r.feed.name} » est créé`);
      navigate(`/feeds/${r.feed.id}`);
    },
  });

  const set = (key: string, value: string | boolean) => setValues((v) => ({ ...v, [key]: value }));
  const missing = recipe?.params.some((p) => p.required && !String(values[p.key] ?? '').trim()) ?? true;

  return (
    <Dialog
      open={!!recipe}
      onClose={() => {
        run.reset();
        onClose();
      }}
      title={
        recipe && (
          <span className="recipe-dialog-title">
            <BrandIcon name={recipe.icon} size={24} />
            {recipe.name}
          </span>
        )
      }
      footer={
        <>
          <Button variant="ghost" onClick={() => run.mutate('customize')} disabled={missing || run.isPending} loading={run.isPending && run.variables === 'customize'}>
            Ajuster avant de créer
          </Button>
          <Button variant="primary" type="submit" form="recipe-form" disabled={missing} loading={run.isPending && run.variables === 'create'}>
            Créer le flux
          </Button>
        </>
      }
    >
      {recipe && (
        <form
          id="recipe-form"
          className="recipe-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!missing) run.mutate('create');
          }}
        >
          <p className="muted">{recipe.description}</p>
          {recipe.params.map((p, i) =>
            p.type === 'checkbox' ? (
              <Toggle key={p.key} checked={values[p.key] === true} onChange={(v) => set(p.key, v)} label={p.label} description={p.help} />
            ) : p.type === 'select' ? (
              <Field key={p.key} label={p.label} htmlFor={`recipe-${p.key}`} hint={p.help}>
                <Select id={`recipe-${p.key}`} value={String(values[p.key] ?? '')} onChange={(e) => set(p.key, e.target.value)}>
                  {p.options?.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : (
              <Field key={p.key} label={p.label} htmlFor={`recipe-${p.key}`} hint={p.help}>
                <Input
                  id={`recipe-${p.key}`}
                  value={String(values[p.key] ?? '')}
                  placeholder={p.placeholder}
                  autoFocus={i === 0}
                  spellCheck={false}
                  onChange={(e) => set(p.key, e.target.value)}
                />
              </Field>
            ),
          )}
          {run.error && (
            <p className="callout callout-error" role="alert">
              {run.error.message}
            </p>
          )}
        </form>
      )}
    </Dialog>
  );
}

export function RecipesPage() {
  const recipes = useQuery({ queryKey: ['recipes'], queryFn: api.recipes, staleTime: Infinity });
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  useDocumentTitle('Recettes');

  const openId = params.get('open');
  const rawPreset = params.get('params');
  const preset = useMemo<Values | null>(() => {
    if (!rawPreset) return null;
    try {
      return JSON.parse(rawPreset) as Values;
    } catch {
      return null;
    }
  }, [rawPreset]);
  const active = recipes.data?.find((r) => r.id === openId) ?? null;

  return (
    <>
      <header className="page-head">
        <div>
          <h1 className="display page-title">Recettes</h1>
          <p className="page-lede">Des flux prêts à l’emploi pour les plateformes courantes : indiquez une chaîne, un compte ou un dépôt, Glaneur s’occupe du reste.</p>
        </div>
      </header>

      {recipes.isPending ? (
        <div className="loading-block">
          <Spinner />
        </div>
      ) : recipes.isError ? (
        <p className="callout callout-error">{recipes.error.message}</p>
      ) : (
        <div className="recipe-grid">
          {recipes.data.map((r) => (
            <button key={r.id} type="button" className="recipe-card card" style={{ '--brand': brandColor(r.icon) } as React.CSSProperties} onClick={() => setParams({ open: r.id })}>
              <span className="recipe-glyph">
                <BrandIcon name={r.icon} size={26} />
              </span>
              <span className="recipe-name display">{r.name}</span>
              <span className="recipe-desc">{r.description}</span>
            </button>
          ))}
        </div>
      )}

      <section className="section">
        <div className="section-head">
          <div>
            <h2 className="display section-title">Pour tous les autres sites</h2>
            <p className="faint section-sub">Ces outils partent d’une adresse que vous indiquerez dans l’éditeur.</p>
          </div>
        </div>
        <ToolCards
          onPick={(kind) =>
            navigate('/editor', {
              state: { draft: kind === 'html' ? htmlDraft('') : kind === 'watch' ? watchDraft('') : kind === 'json' ? jsonDraft('') : feedDraft([]) },
            })
          }
        />
      </section>

      <RecipeDialog recipe={active} preset={preset} onClose={() => setParams({})} />
    </>
  );
}
