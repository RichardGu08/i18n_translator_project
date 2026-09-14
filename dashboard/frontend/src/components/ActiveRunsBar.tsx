import { useEffect, useState } from 'react';
import { fetchTranslationRuns } from '../api';
import type { TranslationRun } from '../types';

const POLL_INTERVAL_MS = 3000;

/**
 * Fixed bar pinned to the bottom of the app, visible on every page, showing
 * translation runs that are in progress right now -- the dashboard's own
 * substitute for having to watch the Inngest dev server UI at :8288.
 * Renders nothing when no run is currently active.
 */
export default function ActiveRunsBar() {
  const [runs, setRuns] = useState<TranslationRun[]>([]);

  useEffect(() => {
    let cancelled = false;

    const poll = () => {
      fetchTranslationRuns()
        .then((all) => {
          if (!cancelled) setRuns(all.filter((r) => r.status === 'running'));
        })
        .catch(() => {
          // Transient poll failures shouldn't spam the UI -- just try again next tick.
        });
    };

    poll();
    const handle = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(handle);
    };
  }, []);

  if (runs.length === 0) return null;

  return (
    <div className="active-runs-bar">
      <span className="active-runs-label">Translating now:</span>
      <div className="active-runs-list">
        {runs.map((run) => (
          <span className="active-run-chip" key={run.id}>
            <span className="active-run-spinner" aria-hidden="true" />
            <span className="lang-badge">{run.language}</span>
            <span>
              {run.translated_count}/{run.total_terms} terms
              {run.failed_chunks > 0 ? ` · ${run.failed_chunks} chunk(s) failed` : ''}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}
