import { Fragment, useEffect, useMemo, useState } from 'react';
import {
  bulkLockTranslations,
  clearTranslationHistory,
  deleteHistoryEntry,
  fetchAllTranslations,
  fetchLanguages,
  fetchTranslationHistory,
  patchTranslation,
} from '../api';
import type { HistoryEntry, Language, Translation } from '../types';

const PAGE_SIZE = 50;

type LockedFilter = 'all' | 'locked' | 'unlocked';

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString();
}

function ChangeTypeBadge({ changeType }: { changeType: HistoryEntry['change_type'] }) {
  const className =
    changeType === 'ai' ? 'badge badge-ai' : changeType === 'manual' ? 'badge badge-manual' : 'badge badge-import';
  return <span className={className}>{changeType}</span>;
}

interface ExpandedRowProps {
  translation: Translation;
  onSaved: (updated: Translation) => void;
}

function ExpandedRow({ translation, onSaved }: ExpandedRowProps) {
  const [draftText, setDraftText] = useState(translation.translated_text);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const [history, setHistory] = useState<HistoryEntry[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [deletingHistoryId, setDeletingHistoryId] = useState<number | null>(null);
  const [clearingHistory, setClearingHistory] = useState(false);

  useEffect(() => {
    setDraftText(translation.translated_text);
  }, [translation.id, translation.translated_text]);

  const loadHistory = () => {
    setHistoryLoading(true);
    setHistoryError(null);
    fetchTranslationHistory(translation.id)
      .then((entries) => setHistory(entries))
      .catch((err: Error) => setHistoryError(err.message))
      .finally(() => setHistoryLoading(false));
  };

  useEffect(() => {
    loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [translation.id]);

  const dirty = draftText !== translation.translated_text;

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);
    try {
      const updated = await patchTranslation(translation.id, { translated_text: draftText });
      onSaved(updated);
      setSaveSuccess(true);
      // Refresh history since a new manual version was likely created.
      loadHistory();
    } catch (err) {
      setSaveError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteHistoryEntry = async (historyId: number) => {
    setDeletingHistoryId(historyId);
    try {
      await deleteHistoryEntry(translation.id, historyId);
      setHistory((prev) => (prev ? prev.filter((h) => h.id !== historyId) : prev));
    } catch (err) {
      setHistoryError((err as Error).message);
    } finally {
      setDeletingHistoryId(null);
    }
  };

  const handleClearHistory = async () => {
    setClearingHistory(true);
    try {
      await clearTranslationHistory(translation.id);
      setHistory([]);
    } catch (err) {
      setHistoryError((err as Error).message);
    } finally {
      setClearingHistory(false);
    }
  };

  return (
    <tr className="expand-row">
      <td colSpan={8}>
        <div className="edit-panel">
          <label htmlFor={`edit-${translation.id}`}>
            Translated text ({translation.language})
          </label>
          <textarea
            id={`edit-${translation.id}`}
            value={draftText}
            onChange={(e) => setDraftText(e.target.value)}
          />
          <div className="edit-actions">
            <button className="btn" onClick={handleSave} disabled={saving || !dirty}>
              {saving ? 'Saving…' : 'Save'}
            </button>
            {saveSuccess && <span className="save-status">Saved.</span>}
            {saveError && <span className="save-status">Error: {saveError}</span>}
          </div>
        </div>

        <div className="history-panel">
          <div className="edit-actions" style={{ marginTop: 0 }}>
            <h4 style={{ margin: 0 }}>History</h4>
            {history && history.length > 0 && (
              <button className="btn btn-secondary" onClick={handleClearHistory} disabled={clearingHistory}>
                {clearingHistory ? 'Clearing…' : 'Clear all history'}
              </button>
            )}
          </div>
          {historyLoading && <p className="muted">Loading history…</p>}
          {historyError && <p className="error-banner">Failed to load history: {historyError}</p>}
          {!historyLoading && !historyError && history && history.length === 0 && (
            <p className="muted">No history entries yet.</p>
          )}
          {!historyLoading && !historyError && history && history.length > 0 && (
            <div className="history-list">
              {history.map((entry) => (
                <div className="history-entry" key={entry.id}>
                  <div className="history-entry-meta">
                    <strong>v{entry.version}</strong>
                    <ChangeTypeBadge changeType={entry.change_type} />
                    <span>{formatDate(entry.changed_at)}</span>
                    <button
                      className="btn btn-danger"
                      style={{ marginLeft: 'auto', padding: '2px 10px', fontSize: '0.75rem' }}
                      onClick={() => handleDeleteHistoryEntry(entry.id)}
                      disabled={deletingHistoryId === entry.id}
                    >
                      {deletingHistoryId === entry.id ? 'Deleting…' : 'Delete'}
                    </button>
                  </div>
                  <div className="history-entry-text">{entry.translated_text}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </td>
    </tr>
  );
}

export default function TranslationsPage() {
  const [allItems, setAllItems] = useState<Translation[]>([]);
  const [languages, setLanguages] = useState<Language[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [searchInput, setSearchInput] = useState('');
  // Always a specific target language code -- there is no "all languages"
  // view, and the source language (English) is never a filter option.
  const [languageFilter, setLanguageFilter] = useState<string>('');
  const [lockedFilter, setLockedFilter] = useState<LockedFilter>('all');
  const [page, setPage] = useState(1);

  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [lockUpdating, setLockUpdating] = useState<Set<number>>(new Set());
  const [bulkLocking, setBulkLocking] = useState(false);
  const [bulkLockStatus, setBulkLockStatus] = useState<string | null>(null);

  const targetLanguages = languages.filter((l) => !l.is_source);

  // Fetch the full dataset ONCE. All filtering below is in-memory -- no
  // network round-trip per keystroke/page turn/filter change.
  const loadAll = () => {
    setLoading(true);
    setError(null);
    Promise.all([fetchAllTranslations(), fetchLanguages()])
      .then(([translations, languageList]) => {
        setAllItems(translations);
        setLanguages(languageList);
        setLanguageFilter((prev) => {
          if (prev) return prev;
          const firstTarget = languageList.find((l) => !l.is_source);
          return firstTarget ? firstTarget.code : prev;
        });
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadAll();
  }, []);

  // Reset to page 1 whenever filters change.
  useEffect(() => {
    setPage(1);
  }, [searchInput, languageFilter, lockedFilter]);

  const filteredItems = useMemo(() => {
    if (!languageFilter) return [];
    const needle = searchInput.trim().toLowerCase();
    return allItems.filter((t) => {
      if (t.language !== languageFilter) return false;
      if (lockedFilter === 'locked' && !t.locked) return false;
      if (lockedFilter === 'unlocked' && t.locked) return false;
      if (needle) {
        const haystack = `${t.key} ${t.source_text} ${t.translated_text}`.toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      return true;
    });
  }, [allItems, searchInput, languageFilter, lockedFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredItems.length / PAGE_SIZE));
  const pageItems = useMemo(
    () => filteredItems.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [filteredItems, page]
  );

  const handleToggleLocked = async (translation: Translation) => {
    setLockUpdating((prev) => new Set(prev).add(translation.id));
    try {
      const updated = await patchTranslation(translation.id, { locked: !translation.locked });
      setAllItems((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLockUpdating((prev) => {
        const next = new Set(prev);
        next.delete(translation.id);
        return next;
      });
    }
  };

  const handleRowSaved = (updated: Translation) => {
    setAllItems((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
  };

  const handleBulkLock = async (locked: boolean) => {
    const ids = filteredItems.map((t) => t.id);
    if (ids.length === 0) return;
    setBulkLocking(true);
    setBulkLockStatus(null);
    try {
      const updated = await bulkLockTranslations(ids, locked);
      const updatedById = new Map(updated.map((t) => [t.id, t]));
      setAllItems((prev) => prev.map((t) => updatedById.get(t.id) ?? t));
      setBulkLockStatus(`${locked ? 'Locked' : 'Unlocked'} ${updated.length} translation${updated.length === 1 ? '' : 's'}.`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBulkLocking(false);
    }
  };

  return (
    <div>
      <h2>Translations</h2>

      <div className="page-section">
        <div className="filters-bar">
          <input
            type="text"
            placeholder="Search by key, English text, or translated text…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
          <select
            value={languageFilter}
            onChange={(e) => setLanguageFilter(e.target.value)}
            aria-label="Filter by language"
          >
            {targetLanguages.length === 0 && <option value="">No target languages</option>}
            {targetLanguages.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label} ({l.code})
              </option>
            ))}
          </select>
          <select
            value={lockedFilter}
            onChange={(e) => setLockedFilter(e.target.value as LockedFilter)}
            aria-label="Filter by locked status"
          >
            <option value="all">All</option>
            <option value="locked">Locked only</option>
            <option value="unlocked">Unlocked only</option>
          </select>
          <button className="btn btn-secondary" onClick={loadAll} disabled={loading}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>

        {error && <div className="error-banner">{error}</div>}

        <div className="status-line">
          {loading
            ? 'Loading…'
            : `${filteredItems.length} result${filteredItems.length === 1 ? '' : 's'} (of ${allItems.length} loaded)`}
        </div>

        <div className="edit-actions" style={{ marginBottom: 12 }}>
          <button
            className="btn btn-secondary"
            onClick={() => handleBulkLock(true)}
            disabled={bulkLocking || filteredItems.length === 0}
            title="Lock every translation matching the current search/locked filters for this language -- proofread rows can then be skipped by future translation runs"
          >
            {bulkLocking ? 'Working…' : 'Lock all'}
          </button>
          <button
            className="btn btn-secondary"
            onClick={() => handleBulkLock(false)}
            disabled={bulkLocking || filteredItems.length === 0}
          >
            Unlock all
          </button>
          {bulkLockStatus && <span className="save-status">{bulkLockStatus}</span>}
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th aria-label="Expand" />
                <th>Key</th>
                <th>Language</th>
                <th>English Source</th>
                <th>Translated Text</th>
                <th>Locked</th>
                <th>Version</th>
                <th>Updated At</th>
              </tr>
            </thead>
            <tbody>
              {!loading && pageItems.length === 0 && (
                <tr>
                  <td colSpan={8}>
                    <div className="empty-state">No translations match the current filters.</div>
                  </td>
                </tr>
              )}
              {pageItems.map((t) => {
                const isExpanded = expandedId === t.id;
                return (
                  <Fragment key={t.id}>
                    <tr
                      className={`row-clickable${isExpanded ? ' row-expanded' : ''}`}
                      onClick={() => setExpandedId(isExpanded ? null : t.id)}
                    >
                      <td>
                        <button
                          className="expand-toggle"
                          onClick={(e) => {
                            e.stopPropagation();
                            setExpandedId(isExpanded ? null : t.id);
                          }}
                          aria-label={isExpanded ? 'Collapse row' : 'Expand row'}
                        >
                          {isExpanded ? '▾' : '▸'}
                        </button>
                      </td>
                      <td className="cell-key">{t.key}</td>
                      <td>
                        <span className="lang-badge">{t.language}</span>
                      </td>
                      <td className="cell-text">{t.source_text}</td>
                      <td className="cell-text">{t.translated_text}</td>
                      <td className="checkbox-cell" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={t.locked}
                          disabled={lockUpdating.has(t.id)}
                          onChange={() => handleToggleLocked(t)}
                          aria-label={`Toggle locked for ${t.key}`}
                        />
                      </td>
                      <td>{t.version}</td>
                      <td>{formatDate(t.updated_at)}</td>
                    </tr>
                    {isExpanded && (
                      <ExpandedRow translation={t} onSaved={handleRowSaved} />
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="pagination-bar">
          <button
            className="btn btn-secondary"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
          >
            Previous
          </button>
          <span className="muted">
            Page {page} of {totalPages}
          </span>
          <button
            className="btn btn-secondary"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
