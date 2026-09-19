import type { FetchHistoryEntry } from '../../shared/types';
import { formatDateTime, formatDuration } from '../lib/format';

function entryLabel(e: FetchHistoryEntry): string {
  const when = formatDateTime(e.at);
  if (!e.ok) return `${when} — erreur : ${e.error ?? 'inconnue'}`;
  const added = e.added ? `${e.added} nouveau${e.added > 1 ? 'x' : ''}` : 'rien de nouveau';
  return `${when} — ${added} · ${e.found} trouvé${e.found > 1 ? 's' : ''} · ${formatDuration(e.ms)}`;
}

/**
 * The refresh history as tally marks: a short graphite tick when nothing changed,
 * a taller highlighter stroke when new items arrived, a red stroke on failure.
 */
export function Tally({ history, slots = 30, size = 'md' }: { history: FetchHistoryEntry[]; slots?: number; size?: 'md' | 'lg' }) {
  const recent = history.slice(-slots);
  const failures = recent.filter((e) => !e.ok).length;
  const label = recent.length
    ? `${recent.length} dernières actualisations : ${recent.length - failures} réussies, ${failures} en erreur`
    : 'Aucune actualisation pour l’instant';
  return (
    <div className={`tally tally-${size}`} role="img" aria-label={label}>
      {Array.from({ length: slots - recent.length }, (_, i) => (
        <span key={`empty-${i}`} className="tally-mark is-empty" />
      ))}
      {recent.map((e) => {
        const kind = !e.ok ? 'is-error' : e.added > 0 ? 'is-new' : 'is-same';
        const height = !e.ok ? 100 : e.added > 0 ? Math.min(100, 52 + Math.log2(e.added + 1) * 14) : 34;
        return <span key={e.at} className={`tally-mark ${kind}`} style={{ height: `${height}%` }} title={entryLabel(e)} />;
      })}
    </div>
  );
}
