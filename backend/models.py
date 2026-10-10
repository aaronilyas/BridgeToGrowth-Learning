"""SQLAlchemy models for BridgeToGrowth's initial backend data model.

Video files and their temporary processing paths are deliberately not stored
in these tables. Keep generated artifacts inside the owning isolated user
container and remove them after processing and delivery.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    Uuid,
    func,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class User(Base):
    """Application user; auth credentials/provider linkage are not specified."""

    __tablename__ = "users"
    __table_args__ = (
        UniqueConstraint("phone_number", name="uq_users_phone_number"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    phone_number: Mapped[str] = mapped_column(String(32), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )

    container: Mapped[UserContainer | None] = relationship(
        back_populates="user", cascade="all, delete-orphan", uselist=False
    )
    lesson_jobs: Mapped[list[LessonJob]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )


class UserContainer(Base):
    """The isolated Docker container assigned to one user, when provisioned."""

    __tablename__ = "user_containers"
    __table_args__ = (
        UniqueConstraint("user_id", name="uq_user_containers_user_id"),
        UniqueConstraint("container_handle", name="uq_user_containers_handle"),
        CheckConstraint(
            "status IN ('stopped', 'starting', 'running', 'stopping', 'error')",
            name="ck_user_containers_status",
        ),
        Index("ix_user_containers_status_last_request", "status", "last_authenticated_request_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    # Docker/container runtime identifier only; never a host path or video URL.
    container_handle: Mapped[str | None] = mapped_column(String(255), nullable=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="stopped", server_default="stopped")
    last_authenticated_request_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    stopped_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )

    user: Mapped[User] = relationship(back_populates="container")


class LessonJob(Base):
    """A lesson request and its generation/evaluation/delivery lifecycle."""

    __tablename__ = "lesson_jobs"
    __table_args__ = (
        CheckConstraint(
            "status IN ('requested', 'validating', 'needs_breakdown', 'queued', "
            "'generating', 'rendering', 'evaluating', 'delivering', 'accepted', 'delivered', 'failed', 'cancelled')",
            name="ck_lesson_jobs_status",
        ),
        CheckConstraint(
            "estimated_duration_seconds IS NULL OR estimated_duration_seconds >= 0",
            name="ck_lesson_jobs_estimated_duration_nonnegative",
        ),
        Index("ix_lesson_jobs_user_created", "user_id", "created_at"),
        Index("ix_lesson_jobs_status_created", "status", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    # Retained as user-provided text so the result can be evaluated against intent.
    original_request: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="requested", server_default="requested")
    estimated_duration_seconds: Mapped[int | None] = mapped_column(Integer)
    scope_feedback: Mapped[str | None] = mapped_column(Text)
    failure_reason: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    user: Mapped[User] = relationship(back_populates="lesson_jobs")
    deliveries: Mapped[list[VideoDelivery]] = relationship(
        back_populates="lesson_job", cascade="all, delete-orphan"
    )


class VideoDelivery(Base):
    """SMS send attempt metadata; no video or durable video location is stored."""

    __tablename__ = "video_deliveries"
    __table_args__ = (
        CheckConstraint(
            "status IN ('pending', 'accepted', 'delivered', 'failed')",
            name="ck_video_deliveries_status",
        ),
        Index("ix_video_deliveries_job_created", "lesson_job_id", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    lesson_job_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("lesson_jobs.id", ondelete="CASCADE"), nullable=False
    )
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending", server_default="pending")
    provider_message_id: Mapped[str | None] = mapped_column(String(255))
    failure_reason: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    delivered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    lesson_job: Mapped[LessonJob] = relationship(back_populates="deliveries")
