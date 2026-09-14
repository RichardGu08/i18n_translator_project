-- i18n translator schema (MySQL 8)
-- Single source of truth for the `languages`, `translations`, `translation_history`,
-- and `prompt_templates` tables shared by the Inngest translation pipeline and the
-- dashboard backend.

CREATE TABLE IF NOT EXISTS languages (
    code           VARCHAR(10) PRIMARY KEY,     -- 'en', 'fr', 'es', ...
    label          VARCHAR(100) NOT NULL,       -- display name, e.g. 'French'
    is_source      BOOLEAN NOT NULL DEFAULT FALSE, -- true only for the single English/source language
    active         BOOLEAN NOT NULL DEFAULT TRUE,  -- inactive languages are skipped by the translation pipeline
    sort_order     INT NOT NULL DEFAULT 0,
    created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT IGNORE INTO languages (code, label, is_source, active, sort_order) VALUES
    ('en', 'English', TRUE, TRUE, 0),
    ('fr', 'French', FALSE, TRUE, 1),
    ('es', 'Spanish', FALSE, TRUE, 2);

CREATE TABLE IF NOT EXISTS translations (
    id             INT AUTO_INCREMENT PRIMARY KEY,
    `key`          VARCHAR(500) NOT NULL,
    language       VARCHAR(10) NOT NULL,
    source_text    TEXT NOT NULL,              -- English text this row is a translation of (== translated_text when language is the source language)
    source_hash    CHAR(64) NOT NULL,          -- sha256 of source_text at the time translated_text was last generated
    translated_text TEXT NOT NULL,
    locked         BOOLEAN NOT NULL DEFAULT FALSE,
    version        INT NOT NULL DEFAULT 1,
    updated_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_translations_key_language UNIQUE (`key`, language),
    CONSTRAINT fk_translations_language FOREIGN KEY (language) REFERENCES languages (code)
);

CREATE INDEX idx_translations_language ON translations (language);
CREATE INDEX idx_translations_locked ON translations (locked);

CREATE TABLE IF NOT EXISTS translation_history (
    id             INT AUTO_INCREMENT PRIMARY KEY,
    translation_id INT NOT NULL,
    version        INT NOT NULL,
    translated_text TEXT NOT NULL,
    source_hash    CHAR(64) NOT NULL,
    change_type    VARCHAR(20) NOT NULL,
    changed_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_translation_history_translation FOREIGN KEY (translation_id)
        REFERENCES translations (id) ON DELETE CASCADE,
    CONSTRAINT chk_translation_history_change_type
        CHECK (change_type IN ('ai', 'manual', 'import'))
);

CREATE INDEX idx_translation_history_translation_id ON translation_history (translation_id);

CREATE TABLE IF NOT EXISTS prompt_templates (
    id             INT AUTO_INCREMENT PRIMARY KEY,
    language       VARCHAR(10) NOT NULL UNIQUE,
    template_text  TEXT NOT NULL,
    version        INT NOT NULL DEFAULT 1,
    updated_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_prompt_templates_language FOREIGN KEY (language) REFERENCES languages (code)
);

CREATE TABLE IF NOT EXISTS translation_runs (
    id               INT AUTO_INCREMENT PRIMARY KEY,
    language         VARCHAR(10) NOT NULL,
    status           VARCHAR(20) NOT NULL DEFAULT 'running', -- running | succeeded | partial | failed
    total_terms      INT NOT NULL DEFAULT 0,
    translated_count INT NOT NULL DEFAULT 0,
    failed_chunks    INT NOT NULL DEFAULT 0,
    error            TEXT NULL,
    started_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    finished_at      TIMESTAMP NULL,
    CONSTRAINT fk_translation_runs_language FOREIGN KEY (language) REFERENCES languages (code)
);

CREATE INDEX idx_translation_runs_status ON translation_runs (status);

-- Seed default prompt templates so a fresh install works out of the box.
-- {{terms}} is replaced with a JSON array of {"key": ..., "text": ...} objects for the current chunk.
INSERT IGNORE INTO prompt_templates (language, template_text) VALUES (
    'fr',
    'You are a professional English-to-French translator for a software product\'s UI text. Translate each "text" value into natural, concise French appropriate for a UI (buttons, labels, messages). Preserve any placeholders like {{name}} or %s exactly as-is. Do not translate the "key" values. Return ONLY a JSON array of objects with "key" and "translatedText" fields, one per input item, same order as input.\n\nInput items:\n{{terms}}'
);

INSERT IGNORE INTO prompt_templates (language, template_text) VALUES (
    'es',
    'You are a professional English-to-Spanish translator for a software product\'s UI text. Translate each "text" value into natural, concise Spanish (Latin America neutral) appropriate for a UI (buttons, labels, messages). Preserve any placeholders like {{name}} or %s exactly as-is. Do not translate the "key" values. Return ONLY a JSON array of objects with "key" and "translatedText" fields, one per input item, same order as input.\n\nInput items:\n{{terms}}'
);
