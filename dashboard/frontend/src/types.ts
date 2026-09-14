export interface Translation {
  id: number;
  key: string;
  language: string;
  source_text: string;
  source_hash: string;
  translated_text: string;
  locked: boolean;
  version: number;
  updated_at: string;
}

export type ChangeType = 'ai' | 'manual' | 'import';

export interface HistoryEntry {
  id: number;
  translation_id: number;
  version: number;
  translated_text: string;
  source_hash: string;
  change_type: ChangeType;
  changed_at: string;
}

export interface Language {
  code: string;
  label: string;
  is_source: boolean;
  active: boolean;
  sort_order: number;
}

export interface LanguageCreateBody {
  code: string;
  label: string;
  sort_order?: number;
  template_text?: string;
}

export interface LanguageUpdateBody {
  label?: string;
  active?: boolean;
  sort_order?: number;
}

export interface PromptTemplate {
  id: number;
  language: string;
  template_text: string;
  version: number;
  updated_at: string;
}

export interface ImportSummary {
  imported: number;
  updated: number;
  unchanged: number;
}

export interface TranslationPatchBody {
  locked?: boolean;
  translated_text?: string;
}

export interface BulkLockBody {
  ids: number[];
  locked: boolean;
}

export type TranslationRunStatus = 'running' | 'succeeded' | 'partial' | 'failed';

export interface TranslationRun {
  id: number;
  language: string;
  status: TranslationRunStatus;
  total_terms: number;
  translated_count: number;
  failed_chunks: number;
  error: string | null;
  started_at: string;
  finished_at: string | null;
}

export interface TranslationRunTrigger {
  event_id: string;
  languages: string[];
}
