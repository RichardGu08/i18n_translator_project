import { useEffect, useRef, useState } from 'react';
import {
  exportLanguage,
  fetchExportText,
  fetchLanguages,
  fetchTranslationRuns,
  importTerms,
  triggerTranslationRun,
} from '../api';
import type { ImportSummary, Language, TranslationRun } from '../types';

const RUNS_POLL_INTERVAL_MS = 4000;

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString();
}

function RunStatusBadge({ status }: { status: TranslationRun['status'] }) {
  const className =
    status === 'succeeded'
      ? 'badge badge-manual'
      : status === 'failed'
        ? 'badge badge-import'
        : status === 'partial'
          ? 'badge badge-import'
          : 'badge badge-ai';
  return <span className={className}>{status}</span>;
}

export default function ImportExportPage() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);

  const [languages, setLanguages] = useState<Language[]>([]);
  const [exportingLang, setExportingLang] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [viewingLang, setViewingLang] = useState<string | null>(null);
  const [viewingContent, setViewingContent] = useState<string | null>(null);
  const [viewingError, setViewingError] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);

  const [selectedLanguages, setSelectedLanguages] = useState<Set<string>>(new Set());
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [runInfo, setRunInfo] = useState<string | null>(null);

  const [runs, setRuns] = useState<TranslationRun[]>([]);

  useEffect(() => {
    fetchLanguages()
      .then((list) => {
        setLanguages(list);
        setSelectedLanguages(new Set(list.filter((l) => !l.is_source).map((l) => l.code)));
      })
      .catch(() => {
        /* language dropdown is a convenience; ignore load failure here */
      });
  }, []);

  useEffect(() => {
    let cancelled = false;
    const poll = () => {
      fetchTranslationRuns()
        .then((all) => {
          if (!cancelled) setRuns(all.slice(0, 8));
        })
        .catch(() => {
          /* recent-runs list is a convenience; ignore poll failures */
        });
    };
    poll();
    const handle = setInterval(poll, RUNS_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(handle);
    };
  }, []);

  const targetLanguages = languages.filter((l) => !l.is_source);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    setSelectedFile(file);
    setSummary(null);
    setImportError(null);
  };

  const handleUpload = async () => {
    if (!selectedFile) return;
    setImporting(true);
    setImportError(null);
    setSummary(null);
    try {
      const result = await importTerms(selectedFile);
      setSummary(result);
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (err) {
      setImportError((err as Error).message);
    } finally {
      setImporting(false);
    }
  };

  const toggleLanguageSelected = (code: string) => {
    setSelectedLanguages((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };

  const handleRunTranslation = async () => {
    setRunning(true);
    setRunError(null);
    setRunInfo(null);
    try {
      const { languages: queued } = await triggerTranslationRun(Array.from(selectedLanguages));
      setRunInfo(queued.length > 0 ? `Queued: ${queued.join(', ')}` : 'No languages were queued.');
    } catch (err) {
      setRunError((err as Error).message);
    } finally {
      setRunning(false);
    }
  };

  const handleExport = async (language: string) => {
    setExportingLang(language);
    setExportError(null);
    try {
      await exportLanguage(language);
    } catch (err) {
      setExportError((err as Error).message);
    } finally {
      setExportingLang(null);
    }
  };

  const handleViewJson = async (language: string) => {
    if (viewingLang === language) {
      setViewingLang(null);
      setViewingContent(null);
      return;
    }
    setViewingLang(language);
    setViewingContent(null);
    setViewingError(null);
    setCopyStatus(null);
    try {
      const text = await fetchExportText(language);
      setViewingContent(text);
    } catch (err) {
      setViewingError((err as Error).message);
    }
  };

  const handleCopy = async () => {
    if (!viewingContent) return;
    try {
      await navigator.clipboard.writeText(viewingContent);
      setCopyStatus('Copied.');
    } catch (err) {
      setCopyStatus(`Copy failed: ${(err as Error).message}`);
    }
  };

  return (
    <div>
      <h2>Import / Export</h2>

      <div className="import-export-grid">
        <div className="page-section">
          <h3>Import English terms</h3>
          <p className="muted">
            Upload a JSON file of English source terms. New keys are imported, existing keys are
            updated if unlocked, and unchanged keys are left as-is.
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            onChange={handleFileChange}
          />
          <div className="edit-actions">
            <button className="btn" onClick={handleUpload} disabled={!selectedFile || importing}>
              {importing ? 'Uploading…' : 'Upload'}
            </button>
          </div>

          {importError && <div className="error-banner">{importError}</div>}

          {summary && (
            <div className="success-banner">
              Import complete: {summary.imported} imported, {summary.updated} updated,{' '}
              {summary.unchanged} unchanged.
            </div>
          )}

          {summary && (
            <table className="summary-table">
              <thead>
                <tr>
                  <th>Imported</th>
                  <th>Updated</th>
                  <th>Unchanged</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>{summary.imported}</td>
                  <td>{summary.updated}</td>
                  <td>{summary.unchanged}</td>
                </tr>
              </tbody>
            </table>
          )}
        </div>

        <div className="page-section">
          <h3>Run translation</h3>
          <p className="muted">
            Choose which language(s) to run -- e.g. run just German, download it, without touching
            French or Spanish. Runs in the background with automatic retries/concurrency limits;
            progress shows live at the bottom of the dashboard (or in the Inngest dev UI at{' '}
            <code>localhost:8288</code>).
          </p>

          {targetLanguages.length === 0 && (
            <p className="muted">No target languages configured yet -- add one on the Languages page.</p>
          )}

          <div className="filters-bar" style={{ marginBottom: 12 }}>
            {targetLanguages.map((lang) => (
              <label key={lang.code} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input
                  type="checkbox"
                  checked={selectedLanguages.has(lang.code)}
                  onChange={() => toggleLanguageSelected(lang.code)}
                />
                {lang.label} <span className="lang-badge">{lang.code}</span>
              </label>
            ))}
          </div>

          {runError && <div className="error-banner">{runError}</div>}
          {runInfo && <div className="success-banner">{runInfo}</div>}

          <div className="edit-actions">
            <button
              className="btn"
              onClick={handleRunTranslation}
              disabled={running || selectedLanguages.size === 0}
            >
              {running ? 'Triggering…' : `Run selected (${selectedLanguages.size})`}
            </button>
          </div>

          {runs.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <h4 style={{ marginBottom: 8 }}>Recent runs</h4>
              <div className="history-list">
                {runs.map((run) => (
                  <div className="history-entry" key={run.id}>
                    <div className="history-entry-meta">
                      <span className="lang-badge">{run.language}</span>
                      <RunStatusBadge status={run.status} />
                      <span>
                        {run.translated_count}/{run.total_terms} terms
                        {run.failed_chunks > 0 ? ` · ${run.failed_chunks} chunk(s) failed` : ''}
                      </span>
                      <span>{formatDate(run.started_at)}</span>
                    </div>
                    {run.error && <div className="history-entry-text">{run.error}</div>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="page-section">
          <h3>Export translations</h3>
          <p className="muted">Download the current translated JSON for a language, or copy it directly.</p>

          {exportError && <div className="error-banner">{exportError}</div>}

          <div className="export-buttons">
            {targetLanguages.length === 0 && (
              <p className="muted">No target languages configured yet -- add one on the Languages page.</p>
            )}
            {targetLanguages.map((lang) => (
              <div key={lang.code} style={{ display: 'flex', gap: 8 }}>
                <button
                  className="btn btn-secondary"
                  onClick={() => handleExport(lang.code)}
                  disabled={exportingLang !== null}
                >
                  {exportingLang === lang.code ? 'Downloading…' : `Download ${lang.label} JSON`}
                </button>
                <button className="btn btn-secondary" onClick={() => handleViewJson(lang.code)}>
                  {viewingLang === lang.code ? 'Close' : 'View / Copy JSON'}
                </button>
              </div>
            ))}
          </div>

          {viewingLang && (
            <div style={{ marginTop: 16 }}>
              {viewingError && <div className="error-banner">Failed to load: {viewingError}</div>}
              {viewingContent !== null && (
                <>
                  <div className="edit-actions" style={{ marginTop: 0, marginBottom: 8 }}>
                    <button className="btn" onClick={handleCopy}>
                      Copy to clipboard
                    </button>
                    {copyStatus && <span className="save-status">{copyStatus}</span>}
                  </div>
                  <pre className="json-preview">{viewingContent}</pre>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
