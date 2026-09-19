import type { CSSProperties } from 'react';
import type { FieldKey } from '../../shared/types';
import { FIELD_META, FIELD_ORDER, type PickMode } from '../lib/fields';
import type { EngineMode, EngineStats } from '../picker/engine';

export function Palette({ mode, onMode, stats, variant }: { mode: EngineMode; onMode: (m: EngineMode) => void; stats: EngineStats; variant: 'html' | 'watch' }) {
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
        <span className="palette-hint">{active ? 'Cliquez sur la zone dans la page · Échap pour arrêter' : 'Sans zone, toute la page est surveillée'}</span>
      </div>
    );
  }

  const modes: PickMode[] = ['item', ...FIELD_ORDER];
  const current = mode && mode !== 'region' ? FIELD_META[mode] : null;
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
      <span className="palette-hint">{current ? `${current.hint} : cliquez dans la page · Échap pour arrêter` : 'Choisissez un champ, puis cliquez dans la page'}</span>
    </div>
  );
}
