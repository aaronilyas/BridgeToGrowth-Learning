"""Single coordinator, atomic admission/shutdown, metadata-only durable recovery."""
from collections import defaultdict
from datetime import datetime, timedelta, timezone
import hashlib
import json
import logging
import threading
import uuid

from sqlalchemy import select

from .models import LessonJob, ReceiptEvent, User, UserContainer, VideoDelivery
from .auth import utc

log = logging.getLogger(__name__)
TERMINAL = {'needs_breakdown', 'accepted', 'failed', 'cancelled', 'interrupted', 'delivery_unknown'}


class Cancelled(Exception):
    pass


class Conflict(ValueError):
    pass


class Service:
    def __init__(self, sessions, integrations, runtime, clock=None):
        self.sessions, self.integrations, self.runtime = sessions, integrations, runtime
        self.clock = clock or (lambda: datetime.now(timezone.utc))
        self.locks = defaultdict(threading.RLock)
        self.active = defaultdict(int)
        self.execution = defaultdict(threading.Lock)
        self.recovering = set()
        self.receipt_lock = threading.RLock()

    def touch(self, identity):
        with self.locks[identity], self.sessions() as db:
            user = db.get(User, identity)
            if user is None or user.container is None:
                return False
            user.container.last_authenticated_request_at = self.clock()
            db.commit()
            return True

    def submit(self, identity, intent, voiceover=False, idempotency_key=None, admission=False):
        fingerprint = hashlib.sha256(json.dumps({'topic': intent, 'voiceover': voiceover},
                                    sort_keys=True, separators=(',', ':')).encode()).hexdigest()
        with self.locks[identity], self.sessions() as db:
            if idempotency_key:
                existing = db.scalar(select(LessonJob).where(LessonJob.user_id == identity,
                    LessonJob.idempotency_key == idempotency_key))
                if existing:
                    if existing.request_hash != fingerprint:
                        raise Conflict('Idempotency key already used for a different request')
                    return (existing.id, False) if admission else existing.id
            pending = db.scalar(select(LessonJob.id).where(LessonJob.user_id == identity, LessonJob.cleanup_required.is_(True), LessonJob.status.in_(TERMINAL)).limit(1))
            if identity in self.recovering or pending:
                raise Conflict('Previous work is being recovered; try again later')
            job = LessonJob(user_id=identity, original_request=intent, status='queued', voiceover=voiceover,
                            idempotency_key=idempotency_key, request_hash=fingerprint)
            db.add(job)
            db.commit()
            self.active[identity] += 1
            return (job.id, True) if admission else job.id

    def status(self, identity, job_id):
        with self.sessions() as db:
            job = db.scalar(select(LessonJob).where(LessonJob.id == job_id, LessonJob.user_id == identity))
            if job is None:
                return None
            accepted = self.acceptance(job)
            return {'id': str(job.id), 'status': job.status,
                    'estimated_duration_seconds': job.estimated_duration_seconds,
                    'rendered_duration_seconds': float(job.rendered_duration_seconds) if job.rendered_duration_seconds else None,
                    'feedback': job.scope_feedback, 'failure_reason': job.failure_reason,
                    'evaluation': job.evaluation, 'cancel_requested': job.cancel_requested,
                    'cleanup_pending': job.cleanup_required,
                    'photon_accepted': accepted is not None,
                    'provider_message_id': accepted.provider_message_id if accepted else None,
                    'receipt_status': 'read' if accepted and accepted.read_at else 'unconfirmed',
                    'read_at': utc(accepted.read_at).isoformat() if accepted and accepted.read_at else None}

    @staticmethod
    def acceptance(job):
        return next((d for d in job.deliveries if d.status == 'accepted' and d.accepted_at is not None
                     and d.provider_message_id and d.provider_message_id.strip()), None)

    def update(self, job_id, status, **fields):
        with self.sessions() as db:
            identity = db.scalar(select(LessonJob.user_id).where(LessonJob.id == job_id))
        with self.locks[identity], self.sessions() as db:
            job = db.get(LessonJob, job_id)
            # Persisted cancellation participates in every stage transition.
            if job.cancel_requested and status not in ('cancelled', 'accepted', 'delivery_unknown'):
                raise Cancelled()
            job.status = status
            for key, value in fields.items():
                setattr(job, key, value)
            if status in TERMINAL:
                job.completed_at = self.clock()
            db.commit()

    def check_cancel(self, identity, job_id):
        with self.locks[identity], self.sessions() as db:
            if db.get(LessonJob, job_id).cancel_requested:
                raise Cancelled()

    def cancel(self, identity, job_id):
        with self.locks[identity], self.sessions() as db:
            job = db.scalar(select(LessonJob).where(LessonJob.id == job_id, LessonJob.user_id == identity))
            if job is None:
                return None
            if job.status == 'delivering' or job.status in ('accepted', 'delivery_unknown'):
                raise Conflict('Messaging has started; an accepted message cannot be retracted')
            if job.status not in TERMINAL:
                job.cancel_requested = True
                stage = job.status
                db.commit()
                if stage in ('generating', 'rendering'):
                    container = db.scalar(select(UserContainer).where(UserContainer.user_id == identity))
                    if container.container_handle:
                        # Dedicated action: reap inside owning container. Pipeline owns final cleanup.
                        try:
                            self.runtime.command(container.container_handle, 'cancel', job_id)
                        except Exception:
                            log.warning('Cancellation stop pending for lesson %s', job_id)
            return self.status(identity, job_id)

    def process(self, identity, job_id, voiceover=None):
        handle, stage = None, 'validating'
        with self.execution[identity]:
            try:
                with self.locks[identity]:
                    self.check_cancel(identity, job_id)
                    with self.sessions() as db:
                        job = db.get(LessonJob, job_id)
                        if job.status in TERMINAL:
                            return
                        previous_cleanup = db.scalar(select(LessonJob.id).where(LessonJob.user_id == identity,
                            LessonJob.id != job_id, LessonJob.cleanup_required.is_(True), LessonJob.status.in_(TERMINAL)).limit(1))
                        if previous_cleanup or identity in self.recovering:
                            raise RuntimeError('Previous container work requires cleanup')
                        intent = job.original_request
                        voiceover = job.voiceover if voiceover is None else voiceover
                    self.update(job_id, stage)
                scope = self.integrations.assess(intent)
                self.update(job_id, 'validating', estimated_duration_seconds=scope['seconds'])
                if scope['seconds'] > 90:
                    self.update(job_id, 'needs_breakdown', scope_feedback=scope['feedback'] or 'Please split your request into smaller topics.')
                    return
                stage = 'container startup'
                with self.locks[identity]:
                    self.check_cancel(identity, job_id)
                    # Obligation is durable BEFORE starting any container or creating artifacts.
                    with self.sessions() as db:
                        db.get(LessonJob, job_id).cleanup_required = True
                        db.commit()
                    handle = self.runtime.start(identity)
                    with self.sessions() as db:
                        container = db.scalar(select(UserContainer).where(UserContainer.user_id == identity))
                        container.container_handle, container.status = handle, 'running'
                        container.started_at = self.clock()
                        db.commit()
                for action, payload in [('generate', {'intent': intent, 'voiceover': voiceover}),
                                        ('render', {'voiceover': voiceover})]:
                    stage = 'generating' if action == 'generate' else 'rendering'
                    with self.locks[identity]:
                        self.check_cancel(identity, job_id)
                        self.update(job_id, stage)
                    result = self.runtime.command(handle, action, job_id, payload)
                    self.check_cancel(identity, job_id)
                duration = result['seconds']
                if type(duration) not in (int, float) or not 0 < duration <= 90:
                    raise ValueError('Invalid or overlong render')
                if voiceover and result.get('has_audio') is not True:
                    raise ValueError('Requested voiceover has no audio stream')
                video = self.runtime.command(handle, 'video', job_id)
                if not isinstance(video, bytes) or not video or len(video) > 12 * 1024 * 1024:
                    raise ValueError('Invalid video')
                stage = 'evaluating'
                self.update(job_id, stage, rendered_duration_seconds=str(duration))
                evaluation = self.integrations.evaluate(intent, video, voiceover=voiceover)
                # Structured production adapter; deterministic substitutes remain test-only.
                approved = evaluation.get('approved') is True if isinstance(evaluation, dict) else evaluation is True
                metadata = evaluation if isinstance(evaluation, dict) else {'approved': approved, 'findings': ''}
                self.update(job_id, stage, evaluation=metadata)
                if not approved:
                    raise ValueError('Evaluation rejected')
                with self.locks[identity]:
                    self.check_cancel(identity, job_id)
                    # Atomic cancellation cutoff + persisted send intent. Never retry this attempt.
                    stage = 'delivering'
                    with self.sessions() as db:
                        phone = db.get(User, identity).phone_number
                        job = db.get(LessonJob, job_id)
                        job.status = stage
                        delivery = VideoDelivery(lesson_job_id=job_id, recipient_phone=phone)
                        db.add(delivery)
                        db.commit()
                        delivery_id = delivery.id
                message_id = self.integrations.deliver(job_id, phone, video)
                if not isinstance(message_id, str) or not message_id.strip():
                    raise ValueError('Delivery acceptance lacks a provider message ID')
                with self.receipt_lock, self.sessions() as db:
                    delivery = db.get(VideoDelivery, delivery_id)
                    delivery.status, delivery.provider_message_id = 'accepted', message_id
                    accepted_at = self.clock()
                    delivery.accepted_at = accepted_at
                    self.apply_receipts(db, delivery)
                    job = db.get(LessonJob, job_id)
                    job.status, job.completed_at = 'accepted', accepted_at
                    db.commit()
            except Cancelled:
                self.update(job_id, 'cancelled', failure_reason=None)
            except Exception as error:
                # Exceptions can contain keys, prompts or provider bodies. Log IDs and stage only.
                log.warning('Lesson %s stopped during %s (%s)', job_id, stage, type(error).__name__)
                try:
                    with self.sessions() as db:
                        cancelled = db.get(LessonJob, job_id).cancel_requested
                    self.update(job_id, 'cancelled' if cancelled else ('delivery_unknown' if stage == 'delivering' else 'failed'),
                                failure_reason=None if cancelled else ('Acceptance could not be established; no automatic resend' if stage == 'delivering' else f'{stage} failed'))
                    if stage == 'delivering':
                        with self.sessions() as db:
                            for delivery in db.scalars(select(VideoDelivery).where(VideoDelivery.lesson_job_id == job_id, VideoDelivery.status == 'pending')):
                                delivery.failure_reason = 'Acceptance not confirmed'
                            db.commit()
                except Exception:
                    log.warning('Could not persist outcome for lesson %s', job_id)
            finally:
                try:
                    safe_without_handle = False
                    if handle:
                        self.runtime.command(handle, 'cleanup', job_id)
                    else:
                        state = self.runtime.state(identity)
                        if state['running'] and not state.get('busy'):
                            self.runtime.command(state['handle'], 'cleanup', job_id)
                            safe_without_handle = True
                        elif not state['running']:
                            safe_without_handle = True
                    with self.sessions() as db:
                        job = db.get(LessonJob, job_id)
                        if handle or safe_without_handle or not job.cleanup_required:
                            job.cleanup_required = False
                        db.commit()
                        pending = job.cleanup_required
                    if pending:
                        self.recovering.add(identity)
                except Exception:
                    log.warning('Cleanup pending for lesson %s', job_id)
                    # Durable obligation remains set; no count release before cleanup.
                else:
                    if not pending:
                        with self.locks[identity]:
                            self.active[identity] = max(0, self.active[identity] - 1)

    def apply_receipts(self, db, delivery):
        receipts = list(db.scalars(select(ReceiptEvent).where(ReceiptEvent.provider_message_id == delivery.provider_message_id,
                                                            ReceiptEvent.recipient_phone == delivery.recipient_phone)))
        if receipts:
            earliest = min(utc(r.read_at) for r in receipts)
            delivery.read_at = min(utc(delivery.read_at), earliest) if delivery.read_at else earliest

    def receipt(self, event_id, message_id, phone, read_at):
        with self.receipt_lock, self.sessions() as db:
            existing = db.get(ReceiptEvent, event_id)
            if existing:
                if (existing.provider_message_id != message_id or existing.recipient_phone != phone
                        or utc(existing.read_at) != utc(read_at)):
                    raise Conflict('Receipt event conflicts with stored evidence')
                return
            # Persist early events; acceptance can commit after its receipt reaches us.
            db.add(ReceiptEvent(event_id=event_id, provider_message_id=message_id,
                                recipient_phone=phone, read_at=read_at, received_at=self.clock()))
            db.flush()
            delivery = db.scalar(select(VideoDelivery).where(VideoDelivery.provider_message_id == message_id,
                                  VideoDelivery.recipient_phone == phone, VideoDelivery.status == 'accepted'))
            if delivery:
                self.apply_receipts(db, delivery)
            db.commit()

    def reconcile(self):
        """Called after the PostgreSQL coordinator guard, and again by sweeps."""
        with self.sessions() as db:
            identities = list(db.scalars(select(UserContainer.user_id)))
        for identity in identities:
            if not self.execution[identity].acquire(blocking=False):
                continue
            try:
                with self.locks[identity]:
                    self.reconcile_user(identity)
            except Exception:
                # Runtime/DB unavailable: preserve work and protection, retry later.
                self.recovering.add(identity)
                log.warning('Recovery pending for account %s', identity)
            finally:
                self.execution[identity].release()

    def reconcile_user(self, identity):
        state = self.runtime.state(identity)
        with self.sessions() as db:
            container = db.scalar(select(UserContainer).where(UserContainer.user_id == identity))
            jobs = list(db.scalars(select(LessonJob).where(LessonJob.user_id == identity)))
            outstanding = [j for j in jobs if j.status not in TERMINAL or j.cleanup_required]
            container.container_handle = state.get('handle')
            container.status = 'running' if state['running'] else 'stopped'
            if state.get('busy'):
                self.recovering.add(identity)
                self.active[identity] = max(1, len(outstanding))
                db.commit()
                return
            # No old process is running. Clean all same-user ephemeral files, including
            # renamed/escaped directories, before releasing recovered protection.
            if state['running']:
                self.runtime.command(state['handle'], 'cleanup', uuid.UUID(int=0))
            for job in outstanding:
                if job.status not in TERMINAL:
                    accepted = self.acceptance(job)
                    if accepted:
                        job.status, job.failure_reason = 'accepted', None
                    elif job.status == 'delivering' or job.deliveries:
                        job.status, job.failure_reason = 'delivery_unknown', 'Interrupted send; acceptance could not be established; no automatic resend'
                    else:
                        job.status = 'cancelled' if job.cancel_requested else 'interrupted'
                        job.failure_reason = None if job.cancel_requested else 'Coordinator interrupted before confirmed delivery'
                    job.completed_at = self.clock()
                job.cleanup_required = False
            if container.last_authenticated_request_at is None:
                container.last_authenticated_request_at = self.clock() - timedelta(minutes=25)
            db.commit()
        self.active[identity] = 0
        self.recovering.discard(identity)

    def sweep(self):
        with self.sessions() as db:
            identities = list(db.scalars(select(UserContainer.user_id)))
        for identity in identities:
            execution = self.execution[identity]
            if not execution.acquire(blocking=False):
                continue
            try:
                with self.locks[identity], self.sessions() as db:
                    cleanup_jobs = list(db.scalars(select(LessonJob).where(LessonJob.user_id == identity,
                        LessonJob.cleanup_required.is_(True), LessonJob.status.in_(TERMINAL))))
                    if identity in self.recovering:
                        self.reconcile_user(identity)
                        continue
                    container = db.scalar(select(UserContainer).where(UserContainer.user_id == identity))
                    for job in cleanup_jobs:
                        try:
                            self.runtime.command(container.container_handle, 'cleanup', job.id)
                            job.cleanup_required = False
                            db.commit()
                            self.active[identity] = max(0, self.active[identity] - 1)
                        except Exception:
                            log.warning('Cleanup retry pending for lesson %s', job.id)
                    active_job = db.scalar(select(LessonJob.id).where(LessonJob.user_id == identity,
                        LessonJob.status.not_in(TERMINAL)).limit(1))
                    last = container.last_authenticated_request_at
                    if (self.active[identity] or active_job or any(j.cleanup_required for j in cleanup_jobs)
                        or container.status != 'running' or last is None
                        or self.clock() - utc(last) < timedelta(minutes=25)):
                        continue
                    self.runtime.stop(container.container_handle)
                    container.status, container.stopped_at = 'stopped', self.clock()
                    db.commit()
            finally:
                execution.release()
