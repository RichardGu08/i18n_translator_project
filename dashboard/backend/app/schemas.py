"""Pydantic request/response models."""
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class TranslationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    key: str
    language: str
    source_text: str
    source_hash: str
    translated_text: str
    locked: bool
    version: int
    updated_at: datetime


class TranslationUpdate(BaseModel):
    locked: bool | None = None
    translated_text: str | None = None


class BulkLockRequest(BaseModel):
    ids: list[int] = Field(min_length=1)
    locked: bool


class TranslationHistoryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    translation_id: int
    version: int
    translated_text: str
    source_hash: str
    change_type: str
    changed_at: datetime


class PromptTemplateOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    language: str
    template_text: str
    version: int
    updated_at: datetime


class PromptTemplateUpdate(BaseModel):
    template_text: str = Field(min_length=1)


class ImportSummary(BaseModel):
    imported: int
    updated: int
    unchanged: int


class LanguageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    code: str
    label: str
    is_source: bool
    active: bool
    sort_order: int


class LanguageCreate(BaseModel):
    code: str = Field(min_length=1, max_length=10)
    label: str = Field(min_length=1, max_length=100)
    sort_order: int = 0
    template_text: str | None = None


class LanguageUpdate(BaseModel):
    label: str | None = None
    active: bool | None = None
    sort_order: int | None = None


class TranslationRunRequest(BaseModel):
    languages: list[str] | None = None


class TranslationRunTrigger(BaseModel):
    event_id: str
    languages: list[str]


class TranslationRunOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    language: str
    status: str
    total_terms: int
    translated_count: int
    failed_chunks: int
    error: str | None
    started_at: datetime
    finished_at: datetime | None
