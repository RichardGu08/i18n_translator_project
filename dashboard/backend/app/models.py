"""SQLAlchemy ORM models mirroring db/schema.sql exactly.

Do not modify db/schema.sql to match these models -- it is the source of
truth; these models mirror it.
"""
from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


class Language(Base):
    __tablename__ = "languages"

    code: Mapped[str] = mapped_column(String(10), primary_key=True)
    label: Mapped[str] = mapped_column(String(100), nullable=False)
    is_source: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="0")
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="1")
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    created_at: Mapped["object"] = mapped_column(DateTime, nullable=False, server_default=func.now())
    updated_at: Mapped["object"] = mapped_column(DateTime, nullable=False, server_default=func.now())


class Translation(Base):
    __tablename__ = "translations"
    __table_args__ = (UniqueConstraint("key", "language", name="uq_translations_key_language"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    key: Mapped[str] = mapped_column(String(500), nullable=False)
    language: Mapped[str] = mapped_column(String(10), ForeignKey("languages.code"), nullable=False)
    source_text: Mapped[str] = mapped_column(Text, nullable=False)
    source_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    translated_text: Mapped[str] = mapped_column(Text, nullable=False)
    locked: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="0")
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    updated_at: Mapped["object"] = mapped_column(DateTime, nullable=False, server_default=func.now())

    history: Mapped[list["TranslationHistory"]] = relationship(
        back_populates="translation", cascade="all, delete-orphan"
    )


class TranslationHistory(Base):
    __tablename__ = "translation_history"
    __table_args__ = (
        CheckConstraint("change_type IN ('ai', 'manual', 'import')", name="chk_translation_history_change_type"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    translation_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("translations.id", ondelete="CASCADE"), nullable=False
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    translated_text: Mapped[str] = mapped_column(Text, nullable=False)
    source_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    change_type: Mapped[str] = mapped_column(String(20), nullable=False)
    changed_at: Mapped["object"] = mapped_column(DateTime, nullable=False, server_default=func.now())

    translation: Mapped["Translation"] = relationship(back_populates="history")


class TranslationRun(Base):
    __tablename__ = "translation_runs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    language: Mapped[str] = mapped_column(String(10), ForeignKey("languages.code"), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="running", server_default="running")
    total_terms: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    translated_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    failed_chunks: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    started_at: Mapped["object"] = mapped_column(DateTime, nullable=False, server_default=func.now())
    finished_at: Mapped["object"] = mapped_column(DateTime, nullable=True)


class PromptTemplate(Base):
    __tablename__ = "prompt_templates"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    language: Mapped[str] = mapped_column(String(10), ForeignKey("languages.code"), nullable=False, unique=True)
    template_text: Mapped[str] = mapped_column(Text, nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    updated_at: Mapped["object"] = mapped_column(DateTime, nullable=False, server_default=func.now())
