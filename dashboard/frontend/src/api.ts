import type {
  BulkLockBody,
  HistoryEntry,
  ImportSummary,
  Language,
  LanguageCreateBody,
  LanguageUpdateBody,
  PromptTemplate,
  Translation,
  TranslationPatchBody,
  TranslationRun,
  TranslationRunTrigger,
} from './types';

const BASE_URL = import.meta.env.VITE_API_BASE_URL;

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail = '';
    try {
      const body = await res.text();
      detail = body;
    } catch {
      // ignore
    }
    throw new Error(
      `Request failed: ${res.status} ${res.statusText}${detail ? ` — ${detail}` : ''}`
    );
  }
  // 204 No Content or empty bodies
  const text = await res.text();
  if (!text) {
    return undefined as unknown as T;
  }
  return JSON.parse(text) as T;
}

/**
 * GET /api/translations
 * Returns the FULL translation set in one response -- the dashboard fetches
 * this once and does all searching/filtering/paging client-side, in memory,
 * for instant zero-latency filtering.
 */
export async function fetchAllTranslations(): Promise<Translation[]> {
  const res = await fetch(`${BASE_URL}/api/translations`);
  return handleResponse<Translation[]>(res);
}

/** GET /api/translations/{id} */
export async function fetchTranslation(id: number): Promise<Translation> {
  const res = await fetch(`${BASE_URL}/api/translations/${id}`);
  return handleResponse<Translation>(res);
}

/** PATCH /api/translations/{id} */
export async function patchTranslation(
  id: number,
  body: TranslationPatchBody
): Promise<Translation> {
  const res = await fetch(`${BASE_URL}/api/translations/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return handleResponse<Translation>(res);
}

/** GET /api/translations/{id}/history */
export async function fetchTranslationHistory(
  id: number
): Promise<HistoryEntry[]> {
  const res = await fetch(`${BASE_URL}/api/translations/${id}/history`);
  return handleResponse<HistoryEntry[]>(res);
}

/** DELETE /api/translations/{id}/history/{historyId} -- delete one past version. */
export async function deleteHistoryEntry(id: number, historyId: number): Promise<void> {
  const res = await fetch(`${BASE_URL}/api/translations/${id}/history/${historyId}`, { method: 'DELETE' });
  if (!res.ok && res.status !== 204) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Request failed: ${res.status} ${res.statusText}${detail ? ` — ${detail}` : ''}`);
  }
}

/** DELETE /api/translations/{id}/history -- delete every past version at once. */
export async function clearTranslationHistory(id: number): Promise<void> {
  const res = await fetch(`${BASE_URL}/api/translations/${id}/history`, { method: 'DELETE' });
  if (!res.ok && res.status !== 204) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Request failed: ${res.status} ${res.statusText}${detail ? ` — ${detail}` : ''}`);
  }
}

/** GET /api/languages */
export async function fetchLanguages(): Promise<Language[]> {
  const res = await fetch(`${BASE_URL}/api/languages`);
  return handleResponse<Language[]>(res);
}

/** POST /api/languages */
export async function createLanguage(body: LanguageCreateBody): Promise<Language> {
  const res = await fetch(`${BASE_URL}/api/languages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return handleResponse<Language>(res);
}

/** PATCH /api/languages/{code} */
export async function updateLanguage(
  code: string,
  body: LanguageUpdateBody
): Promise<Language> {
  const res = await fetch(`${BASE_URL}/api/languages/${code}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return handleResponse<Language>(res);
}

/** DELETE /api/languages/{code} */
export async function deleteLanguage(code: string): Promise<void> {
  const res = await fetch(`${BASE_URL}/api/languages/${code}`, { method: 'DELETE' });
  if (!res.ok && res.status !== 204) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Request failed: ${res.status} ${res.statusText}${detail ? ` — ${detail}` : ''}`);
  }
}

/** GET /api/prompt-templates */
export async function fetchPromptTemplates(): Promise<PromptTemplate[]> {
  const res = await fetch(`${BASE_URL}/api/prompt-templates`);
  return handleResponse<PromptTemplate[]>(res);
}

/** PUT /api/prompt-templates/{language} */
export async function updatePromptTemplate(
  language: string,
  templateText: string
): Promise<PromptTemplate> {
  const res = await fetch(`${BASE_URL}/api/prompt-templates/${language}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ template_text: templateText }),
  });
  return handleResponse<PromptTemplate>(res);
}

/** POST /api/import (multipart file upload, field name "file") */
export async function importTerms(file: File): Promise<ImportSummary> {
  const formData = new FormData();
  formData.append('file', file);

  const res = await fetch(`${BASE_URL}/api/import`, {
    method: 'POST',
    body: formData,
  });
  return handleResponse<ImportSummary>(res);
}

/**
 * GET /api/export/{language}
 * Triggers a browser download of the exported JSON for the given language.
 */
export async function exportLanguage(language: string): Promise<void> {
  const res = await fetch(`${BASE_URL}/api/export/${language}`);
  if (!res.ok) {
    throw new Error(`Export failed: ${res.status} ${res.statusText}`);
  }
  const blob = await res.blob();

  // Try to honor a filename from Content-Disposition, otherwise fall back.
  let filename = `${language}.json`;
  const disposition = res.headers.get('Content-Disposition');
  if (disposition) {
    const match = disposition.match(/filename="?([^";]+)"?/i);
    if (match && match[1]) {
      filename = match[1];
    }
  }

  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

/**
 * GET /api/export/{language} as plain text, for the "View / Copy JSON" panel
 * (as opposed to `exportLanguage`, which triggers a file download).
 */
export async function fetchExportText(language: string): Promise<string> {
  const res = await fetch(`${BASE_URL}/api/export/${language}`);
  if (!res.ok) {
    throw new Error(`Export failed: ${res.status} ${res.statusText}`);
  }
  return res.text();
}

/**
 * POST /api/translation-runs -- fire-and-forget trigger of the Inngest translation
 * pipeline. Pass `languages` to run only a subset (e.g. just German); omit/empty
 * to run every active target language.
 */
export async function triggerTranslationRun(languages?: string[]): Promise<TranslationRunTrigger> {
  const res = await fetch(`${BASE_URL}/api/translation-runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ languages: languages && languages.length > 0 ? languages : null }),
  });
  return handleResponse<TranslationRunTrigger>(res);
}

/** GET /api/translation-runs -- recent runs, newest first (powers the live "active runs" bar). */
export async function fetchTranslationRuns(): Promise<TranslationRun[]> {
  const res = await fetch(`${BASE_URL}/api/translation-runs`);
  return handleResponse<TranslationRun[]>(res);
}

/** PATCH /api/translations/bulk-lock -- lock/unlock a whole batch of ids at once. */
export async function bulkLockTranslations(ids: number[], locked: boolean): Promise<Translation[]> {
  const body: BulkLockBody = { ids, locked };
  const res = await fetch(`${BASE_URL}/api/translations/bulk-lock`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return handleResponse<Translation[]>(res);
}
