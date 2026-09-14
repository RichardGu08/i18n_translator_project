import { useEffect, useState } from 'react';
import {
  createLanguage,
  deleteLanguage,
  fetchLanguages,
  fetchPromptTemplates,
  updateLanguage,
  updatePromptTemplate,
} from '../api';
import type { Language, PromptTemplate } from '../types';

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString();
}

interface LanguageCardProps {
  language: Language;
  template: PromptTemplate | null;
  onLanguageChanged: (updated: Language) => void;
  onLanguageDeleted: (code: string) => void;
  onTemplateSaved: (updated: PromptTemplate) => void;
}

function LanguageCard({
  language,
  template,
  onLanguageChanged,
  onLanguageDeleted,
  onTemplateSaved,
}: LanguageCardProps) {
  const [draftText, setDraftText] = useState(template?.template_text ?? '');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [togglingActive, setTogglingActive] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    setDraftText(template?.template_text ?? '');
  }, [template]);

  const dirty = template ? draftText !== template.template_text : draftText.trim().length > 0;

  const handleSaveTemplate = async () => {
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);
    try {
      const updated = await updatePromptTemplate(language.code, draftText);
      onTemplateSaved(updated);
      setSaveSuccess(true);
    } catch (err) {
      setSaveError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async () => {
    setTogglingActive(true);
    try {
      const updated = await updateLanguage(language.code, { active: !language.active });
      onLanguageChanged(updated);
    } catch (err) {
      setSaveError((err as Error).message);
    } finally {
      setTogglingActive(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteLanguage(language.code);
      onLanguageDeleted(language.code);
    } catch (err) {
      setDeleteError((err as Error).message);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="page-section prompt-card">
      <h3>
        {language.label} <span className="lang-badge">{language.code}</span>{' '}
        {language.is_source && <span className="badge badge-import">source</span>}
        {!language.active && <span className="badge badge-manual">inactive</span>}
      </h3>

      {!language.is_source && (
        <div className="edit-actions" style={{ marginBottom: 12 }}>
          <button className="btn btn-secondary" onClick={handleToggleActive} disabled={togglingActive}>
            {togglingActive ? 'Updating…' : language.active ? 'Deactivate' : 'Activate'}
          </button>
          <button className="btn btn-secondary" onClick={handleDelete} disabled={deleting}>
            {deleting ? 'Deleting…' : 'Delete'}
          </button>
          {deleteError && <span className="save-status">Error: {deleteError}</span>}
        </div>
      )}

      {language.is_source ? (
        <p className="muted">
          Source language -- terms are imported in this language and translated into every other
          active language below.
        </p>
      ) : (
        <>
          <div className="prompt-meta">
            {template
              ? `Version ${template.version} · Last updated ${formatDate(template.updated_at)}`
              : 'No prompt template yet -- add one below.'}
          </div>
          <textarea
            value={draftText}
            onChange={(e) => setDraftText(e.target.value)}
            placeholder="Prompt template. Use {{terms}} as the placeholder for the chunk of terms to translate."
            spellCheck={false}
          />
          <div className="edit-actions">
            <button className="btn" onClick={handleSaveTemplate} disabled={saving || !dirty || !draftText.trim()}>
              {saving ? 'Saving…' : 'Save template'}
            </button>
            {saveSuccess && <span className="save-status">Saved.</span>}
            {saveError && <span className="save-status">Error: {saveError}</span>}
          </div>
        </>
      )}
    </div>
  );
}

export default function LanguagesPage() {
  const [languages, setLanguages] = useState<Language[]>([]);
  const [templates, setTemplates] = useState<Record<string, PromptTemplate>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [newCode, setNewCode] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [newTemplate, setNewTemplate] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const loadAll = () => {
    setLoading(true);
    setLoadError(null);
    Promise.all([fetchLanguages(), fetchPromptTemplates()])
      .then(([languageList, templateList]) => {
        setLanguages(languageList);
        setTemplates(Object.fromEntries(templateList.map((t) => [t.language, t])));
      })
      .catch((err: Error) => setLoadError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadAll();
  }, []);

  const handleCreate = async () => {
    setCreating(true);
    setCreateError(null);
    try {
      const created = await createLanguage({
        code: newCode.trim().toLowerCase(),
        label: newLabel.trim(),
        template_text: newTemplate.trim() || undefined,
      });
      setLanguages((prev) => [...prev, created]);
      if (newTemplate.trim()) {
        setTemplates((prev) => ({
          ...prev,
          [created.code]: {
            id: 0,
            language: created.code,
            template_text: newTemplate.trim(),
            version: 1,
            updated_at: new Date().toISOString(),
          },
        }));
      }
      setNewCode('');
      setNewLabel('');
      setNewTemplate('');
      // Refresh from the server to pick up the real prompt-template record (id/version/updated_at).
      loadAll();
    } catch (err) {
      setCreateError((err as Error).message);
    } finally {
      setCreating(false);
    }
  };

  const handleLanguageChanged = (updated: Language) => {
    setLanguages((prev) => prev.map((l) => (l.code === updated.code ? updated : l)));
  };

  const handleLanguageDeleted = (code: string) => {
    setLanguages((prev) => prev.filter((l) => l.code !== code));
    setTemplates((prev) => {
      const next = { ...prev };
      delete next[code];
      return next;
    });
  };

  const handleTemplateSaved = (updated: PromptTemplate) => {
    setTemplates((prev) => ({ ...prev, [updated.language]: updated }));
  };

  return (
    <div>
      <h2>Languages</h2>
      <p className="muted">
        Languages are data, not code -- add a target language here (with its translation prompt)
        and the translation pipeline picks it up automatically on the next run.
      </p>

      <div className="page-section">
        <h3>Add a language</h3>
        <div className="filters-bar">
          <input
            type="text"
            placeholder="Code (e.g. de)"
            value={newCode}
            onChange={(e) => setNewCode(e.target.value)}
            style={{ maxWidth: 120 }}
          />
          <input
            type="text"
            placeholder="Label (e.g. German)"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            style={{ maxWidth: 200 }}
          />
        </div>
        <label htmlFor="new-template" style={{ display: 'block', marginBottom: 6, fontSize: '0.85rem' }}>
          Prompt template (optional -- can be added later on the language's card)
        </label>
        <textarea
          id="new-template"
          className=""
          value={newTemplate}
          onChange={(e) => setNewTemplate(e.target.value)}
          placeholder="You are a professional English-to-{{language}} translator... {{terms}}"
          style={{ width: '100%', minHeight: 100, padding: 10, fontFamily: 'inherit' }}
        />
        <div className="edit-actions">
          <button
            className="btn"
            onClick={handleCreate}
            disabled={creating || !newCode.trim() || !newLabel.trim()}
          >
            {creating ? 'Adding…' : 'Add language'}
          </button>
          {createError && <span className="save-status">Error: {createError}</span>}
        </div>
      </div>

      {loading && <p className="muted">Loading…</p>}
      {loadError && <p className="error-banner">Failed to load: {loadError}</p>}

      {!loading && !loadError && (
        <div className="prompt-grid">
          {languages.map((language) => (
            <LanguageCard
              key={language.code}
              language={language}
              template={templates[language.code] ?? null}
              onLanguageChanged={handleLanguageChanged}
              onLanguageDeleted={handleLanguageDeleted}
              onTemplateSaved={handleTemplateSaved}
            />
          ))}
        </div>
      )}
    </div>
  );
}
