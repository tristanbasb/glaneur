import { Eye, EyeOff, MousePointerClick } from 'lucide-react';
import type { CSSProperties } from 'react';
import type { FieldKey } from '../../shared/types';
import { FIELD_META, FIELD_ORDER, type PickMode, TOOL_META } from '../lib/fields';
import type { EngineMode, EngineStats } from '../picker/engine';

interface ToolProps {
  /** Chromium is available on the server: needed to click for real. */
  canClick: boolean;
  clicking: boolean;
  hiddenCount: number;
  onRestore: () => void;
}

interface Props extends ToolProps {
  mode: EngineMode;
  onMode: (m: EngineMode) => void;
  stats: EngineStats;
  variant: 'html' | 'watch';
}

/** Acting on the page itself: click a button for real, or put a popup out of the way. */
function PageTools({ mode, onMode, canClick, clicking, hiddenCount, onRestore }: ToolProps & Pick<Props, 'mode' | 'onMode'>) {
  return (
    <>
      <span className="palette-sep" aria-hidden />
      <button
        type="button"
        className={`pal-chip ${mode === 'click' ? 'is-active' : ''}`}
        aria-pressed={mode === 'click'}
        disabled={!canClick || clicking}
        title={canClick ? 'Cliquer sur un bouton de la page, comme un visiteur' : 'Nécessite Chromium sur le serveur'}
        style={{ '--mk': TOOL_META.click.hex } as CSSProperties}
        onClick={() => onMode(mode === 'click' ? null : 'click')}
      >
        <MousePointerClick size={15} aria-hidden />
        {clicking ? 'Clic en cours…' : TOOL_META.click.label}
      </button>
      <button
        type="button"
        className={`pal-chip ${mode === 'hide' ? 'is-active' : ''}`}
        aria-pressed={mode === 'hide'}
        title="Masquer ce qui gêne dans l’aperçu"
        style={{ '--mk': TOOL_META.hide.hex } as CSSProperties}
        onClick={() => onMode(mode === 'hide' ? null : 'hide')}
      >
        <EyeOff size={15} aria-hidden />
        {TOOL_META.hide.label}
      </button>
      {hiddenCount > 0 && (
        <button type="button" className="pal-chip" title="Réafficher ce qui a été masqué" onClick={onRestore}>
          <Eye size={15} aria-hidden />
          Réafficher
          <span className="pal-count">{hiddenCount}</span>
        </button>
      )}
    </>
  );
}

export function Palette({ mode, onMode, stats, variant, ...tools }: Props) {
  const toolHint = mode === 'click' || mode === 'hide' ? TOOL_META[mode].hint : null;

  if (variant === 'watch') {
    const active = mode === 'region';
    return (
      <div className="palette" role="toolbar" aria-label="Désigner la zone">
        <span className="palette-label">Désigner</span>
        <button
          type="button"
          className={`pal-chip ${active ? 'is-active' : ''}`}
          aria-pressed={active}
          style={{ '--mk': 'var(--m-title)' } as CSSProperties}
          onClick={() => onMode(active ? null : 'region')}
        >
          <span className="pal-swatch" />
          La zone à surveiller
          <span className="pal-count">{stats.region || '–'}</span>
        </button>
        <PageTools mode={mode} onMode={onMode} {...tools} />
        <span className="palette-hint">
          {toolHint ?? (active ? 'Cliquez sur la zone dans la page · Échap pour arrêter' : 'Sans zone, toute la page est surveillée')}
        </span>
      </div>
    );
  }

  const modes: PickMode[] = ['item', ...FIELD_ORDER];
  const current = mode && mode in FIELD_META ? FIELD_META[mode as PickMode] : null;
  return (
    <div className="palette" role="toolbar" aria-label="Désigner un champ dans la page">
      <span className="palette-label">Désigner</span>
      {modes.map((m) => {
        const count = m === 'item' ? stats.items : stats.fields[m as FieldKey];
        const active = mode === m;
        return (
          <button
            key={m}
            type="button"
            className={`pal-chip ${active ? 'is-active' : ''}`}
            aria-pressed={active}
            title={FIELD_META[m].hint}
            style={{ '--mk': FIELD_META[m].color } as CSSProperties}
            onClick={() => onMode(active ? null : m)}
          >
            <span className={`pal-swatch ${m === 'item' ? 'is-item' : ''}`} />
            {FIELD_META[m].label}
            <span className="pal-count">{count || '–'}</span>
          </button>
        );
      })}
      <PageTools mode={mode} onMode={onMode} {...tools} />
      <span className="palette-hint">
        {toolHint ?? (current ? `${current.hint} : cliquez dans la page · Échap pour arrêter` : 'Choisissez un champ, puis cliquez dans la page')}
      </span>
    </div>
  );
}
