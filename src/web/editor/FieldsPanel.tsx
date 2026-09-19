import { ChevronsDown, ChevronsUp, SlidersHorizontal } from 'lucide-react';
import { type CSSProperties, useState } from 'react';
import type { FieldKey, FieldRule, HtmlSource } from '../../shared/types';
import { Field, IconButton, Input, Select } from '../components/ui';
import { ATTR_OPTIONS, FIELD_META, FIELD_ORDER } from '../lib/fields';
import { plural } from '../lib/format';
import type { EngineMode, EngineStats } from '../picker/engine';

function countTone(count: number, total: number): string {
  if (!total) return '';
  if (count === 0) return 'is-none';
  return count < total ? 'is-partial' : 'is-ok';
}

interface Props {
  source: HtmlSource;
  onChange: (patch: Partial<HtmlSource>) => void;
  stats: EngineStats;
  mode: EngineMode;
  onMode: (mode: EngineMode) => void;
  onWiden: () => void;
  onNarrow: () => void;
}

export function FieldsPanel({ source, onChange, stats, mode, onMode, onWiden, onNarrow }: Props) {
  const [advanced, setAdvanced] = useState<Partial<Record<FieldKey, boolean>>>({});
  const total = stats.items;

  const setRule = (key: FieldKey, patch: Partial<FieldRule> | null) => {
    const fields = { ...source.fields };
    if (patch === null) delete fields[key];
    else fields[key] = { selector: '', ...fields[key], ...patch };
    onChange({ fields });
  };

  return (
    <section className="panel-section">
      <div className="panel-section-head">
        <h3 className="panel-section-title">Champs</h3>
        {total > 0 && <span className="panel-note">{plural(total, 'élément dans la page', 'éléments dans la page')}</span>}
      </div>

      <div className="rule-row rule-row-item">
        <button
          type="button"
          className={`rule-label ${mode === 'item' ? 'is-active' : ''}`}
          style={{ '--mk': FIELD_META.item.color } as CSSProperties}
          title="Désigner le bloc qui se répète"
          onClick={() => onMode(mode === 'item' ? null : 'item')}
        >
          <span className="pal-swatch is-item" />
          Élément
        </button>
        <Input
          className="mono rule-input"
          aria-label="Sélecteur des éléments"
          placeholder="article.post"
          spellCheck={false}
          value={source.itemSelector}
          title={source.itemSelector}
          onChange={(e) => onChange({ itemSelector: e.target.value })}
        />
        <span className={`rule-count ${source.itemSelector ? (total ? 'is-ok' : 'is-none') : ''}`}>{source.itemSelector ? total : ''}</span>
        <span className="rule-tools">
          <IconButton label="Élargir au bloc parent" onClick={onWiden} disabled={!source.itemSelector.trim()}>
            <ChevronsUp size={16} />
          </IconButton>
          <IconButton label="Resserrer au bloc intérieur" onClick={onNarrow} disabled={!source.itemSelector.trim()}>
            <ChevronsDown size={16} />
          </IconButton>
        </span>
      </div>

      {FIELD_ORDER.map((key) => {
        const rule = source.fields[key];
        const count = stats.fields[key] ?? 0;
        const meta = FIELD_META[key];
        const open = !!advanced[key] && !!rule;
        return (
          <div key={key} className="rule-block">
            <div className="rule-row">
              <button
                type="button"
                className={`rule-label ${mode === key ? 'is-active' : ''}`}
                style={{ '--mk': meta.color } as CSSProperties}
                title={`Désigner « ${meta.label} » dans la page`}
                onClick={() => onMode(mode === key ? null : key)}
              >
                <span className="pal-swatch" />
                {meta.label}
              </button>
              <Input
                className="mono rule-input"
                aria-label={`Sélecteur ${meta.label}`}
                placeholder={key === 'title' || key === 'link' ? 'automatique' : 'non utilisé'}
                spellCheck={false}
                value={rule?.selector ?? ''}
                title={rule?.selector}
                onChange={(e) => setRule(key, e.target.value ? { selector: e.target.value } : null)}
              />
              <span className={`rule-count ${rule ? countTone(count, total) : ''}`} title={rule && total ? `${count} sur ${total}` : undefined}>
                {rule && total ? count : ''}
              </span>
              <IconButton
                label={open ? 'Masquer les options du champ' : 'Options du champ'}
                aria-expanded={open}
                disabled={!rule}
                className={open ? 'is-on' : ''}
                onClick={() => setAdvanced((a) => ({ ...a, [key]: !a[key] }))}
              >
                <SlidersHorizontal size={15} />
              </IconButton>
            </div>
            {open && rule && (
              <div className="rule-advanced">
                <Field label="Valeur lue" htmlFor={`attr-${key}`}>
                  <Select id={`attr-${key}`} value={rule.attr ?? meta.defaultAttr} onChange={(e) => setRule(key, { attr: e.target.value })}>
                    {ATTR_OPTIONS[key].map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Expression régulière" htmlFor={`regex-${key}`} hint="Garde le premier groupe capturé.">
                  <Input id={`regex-${key}`} className="mono" placeholder="(\d+) min" spellCheck={false} value={rule.regex ?? ''} onChange={(e) => setRule(key, { regex: e.target.value || undefined })} />
                </Field>
              </div>
            )}
          </div>
        );
      })}
      <p className="panel-note">Titre et lien vides : Glaneur prend le premier titre et le premier lien de chaque élément.</p>
    </section>
  );
}
