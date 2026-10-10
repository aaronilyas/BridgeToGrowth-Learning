"""One coordinator, per-user admission locks, and metadata-only persistence."""
from collections import defaultdict
from datetime import datetime, timedelta, timezone
import logging
import threading

from sqlalchemy import select

from .models import LessonJob, User, UserContainer, VideoDelivery

log = logging.getLogger(__name__)
TERMINAL = {'needs_breakdown', 'accepted', 'failed', 'cancelled'}


class Service:
    def __init__(self, sessions, integrations, runtime, clock=None):
        self.sessions, self.integrations, self.runtime = sessions, integrations, runtime
        self.clock = clock or (lambda: datetime.now(timezone.utc))
        self.locks = defaultdict(threading.RLock)
        self.active = defaultdict(int)
        self.execution = defaultdict(threading.Lock)
        self.pending_cleanup = defaultdict(dict)

    def register(self, identity, phone):
        with self.locks[identity], self.sessions() as db:
            user = db.get(User, identity)
            if user is None:
                user = User(id=identity, phone_number=phone)
                db.add(user)
                db.add(UserContainer(user_id=identity, last_authenticated_request_at=self.clock()))
            elif user.phone_number != phone:
                raise ValueError('Verified phone differs from registered recipient')
            else:
                user.container.last_authenticated_request_at = self.clock()
            db.commit()
            return {'id': str(identity), 'phone_number': user.phone_number}

    def touch(self, identity):
        with self.locks[identity], self.sessions() as db:
            user = db.get(User, identity)
            if user is None:
                return False
            user.container.last_authenticated_request_at = self.clock()
            db.commit()
            return True

    def submit(self, identity, intent):
        with self.locks[identity], self.sessions() as db:
            job = LessonJob(user_id=identity, original_request=intent, status='queued')
            db.add(job)
            db.commit()
            # Reserved before scheduling, so cleanup cannot pass between admission and execution.
            self.active[identity] += 1
            return job.id

    def status(self, identity, job_id):
        with self.sessions() as db:
            job = db.scalar(select(LessonJob).where(LessonJob.id == job_id, LessonJob.user_id == identity))
            if job is None:
                return None
            accepted = next((d for d in job.deliveries if d.status == 'accepted'), None)
            return {'id': str(job.id), 'status': 'accepted' if accepted else job.status,
                    'estimated_duration_seconds': job.estimated_duration_seconds,
                    'feedback': job.scope_feedback, 'failure_reason': job.failure_reason,
                    'photon_accepted': accepted is not None,
                    'provider_message_id': accepted.provider_message_id if accepted else None}

    def update(self, job_id, status, **fields):
        with self.sessions() as db:
            job = db.get(LessonJob, job_id)
            job.status = status
            for key, value in fields.items():
                setattr(job, key, value)
            if status in TERMINAL:
                job.completed_at = self.clock()
            db.commit()

    def process(self, identity, job_id, voiceover):
        handle = None
        stage = 'validating'
        # Serialize same-user execution; generated code never shares a container with another active render.
        with self.execution[identity]:
            try:
                with self.sessions() as db:
                    job = db.get(LessonJob, job_id)
                    intent = job.original_request
                    phone = db.get(User, identity).phone_number
                self.update(job_id, stage)
                scope = self.integrations.assess(intent)
                self.update(job_id, 'validating', estimated_duration_seconds=scope['seconds'])
                if scope['seconds'] > 90:
                    self.update(job_id, 'needs_breakdown', scope_feedback=scope['feedback'] or
                                'Please split your request into smaller topics.')
                    return
                stage = 'container startup'
                with self.locks[identity]:
                    handle = self.runtime.start(identity)
                with self.sessions() as db:
                    container = db.scalar(select(UserContainer).where(UserContainer.user_id == identity))
                    container.container_handle, container.status = handle, 'running'
                    container.started_at = self.clock()
                    db.commit()
                stage = 'generating'
                self.update(job_id, stage)
                self.runtime.command(handle, 'generate', job_id, {'intent': intent, 'voiceover': voiceover})
                stage = 'rendering'
                self.update(job_id, stage)
                result = self.runtime.command(handle, 'render', job_id)
                duration = result['seconds']
                if type(duration) not in (int, float) or not 0 < duration <= 90:
                    raise ValueError('Invalid or overlong render')
                video = self.runtime.command(handle, 'video', job_id)
                if not isinstance(video, bytes) or not video or len(video) > 12 * 1024 * 1024:
                    raise ValueError('Invalid video')
                stage = 'evaluating'
                self.update(job_id, stage)
                if self.integrations.evaluate(intent, video) is not True:
                    raise ValueError('Evaluation rejected')
                stage = 'delivering'
                self.update(job_id, stage)
                with self.sessions() as db:
                    delivery = VideoDelivery(lesson_job_id=job_id)
                    db.add(delivery)
                    db.commit()
                    delivery_id = delivery.id
                message_id = self.integrations.deliver(job_id, phone, video)
                with self.sessions() as db:
                    delivery = db.get(VideoDelivery, delivery_id)
                    delivery.status, delivery.provider_message_id = 'accepted', message_id
                    accepted_at = self.clock()
                    delivery.accepted_at = accepted_at
                    job = db.get(LessonJob, job_id)
                    job.status, job.completed_at = 'accepted', accepted_at
                    # Acceptance and pipeline completion must become visible together.
                    db.commit()
            except Exception:
                log.exception('Lesson %s failed during %s', job_id, stage)
                try:
                    self.update(job_id, 'failed', failure_reason=f'{stage} failed')
                    if stage == 'delivering':
                        with self.sessions() as db:
                            for delivery in db.scalars(select(VideoDelivery).where(
                                    VideoDelivery.lesson_job_id == job_id, VideoDelivery.status == 'pending')):
                                delivery.status, delivery.failure_reason = 'failed', 'Acceptance not confirmed'
                            db.commit()
                except Exception:
                    log.exception('Could not persist failure for %s', job_id)
            finally:
                try:
                    if handle:
                        self.runtime.command(handle, 'cleanup', job_id)
                except Exception:
                    # Retain protection on cleanup failure; a sweep must not kill potentially active work.
                    with self.locks[identity]:
                        self.pending_cleanup[identity][job_id] = handle
                    log.exception('Cleanup failed for %s; container remains protected', job_id)
                else:
                    with self.locks[identity]:
                        self.active[identity] -= 1

    def sweep(self):
        # Retry temporary cleanup without overlapping a same-user render.
        for identity in list(self.pending_cleanup):
            execution = self.execution[identity]
            if not execution.acquire(blocking=False):
                continue
            try:
                with self.locks[identity]:
                    for job_id, handle in list(self.pending_cleanup[identity].items()):
                        try:
                            self.runtime.command(handle, 'cleanup', job_id)
                        except Exception:
                            log.exception('Cleanup retry failed for %s', job_id)
                        else:
                            del self.pending_cleanup[identity][job_id]
                            self.active[identity] -= 1
            finally:
                execution.release()
        with self.sessions() as db:
            identities = list(db.scalars(select(UserContainer.user_id).where(UserContainer.status == 'running')))
        for identity in identities:
            # Do not block status retrieval/sweeps behind a long-running pipeline.
            lock = self.locks[identity]
            if not lock.acquire(blocking=False):
                continue
            try:
                with self.sessions() as db:
                    container = db.scalar(select(UserContainer).where(UserContainer.user_id == identity))
                    active_job = db.scalar(select(LessonJob.id).where(
                        LessonJob.user_id == identity, LessonJob.status.not_in(TERMINAL)).limit(1))
                    last = container.last_authenticated_request_at
                    if last is not None and last.tzinfo is None:
                        last = last.replace(tzinfo=timezone.utc)
                    if self.active[identity] or active_job or last is None or self.clock() - last < timedelta(minutes=25):
                        continue
                    self.runtime.stop(container.container_handle)
                    container.status, container.stopped_at = 'stopped', self.clock()
                    db.commit()
            finally:
                lock.release()
