"""Executable contract tests with deterministic substitutes; no generated code execution."""
from datetime import datetime, timedelta, timezone
import threading
import os
import logging
import unittest
import uuid
from unittest.mock import patch

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.main import create_app
from backend.models import Base, LessonJob, UserContainer
from backend.service import Service


class Boundaries:
    seconds = 90
    approved = True
    fail = None
    barrier = None

    def __init__(self, a, b):
        self.identities = {'a': a, 'b': b}
        self.calls = []

    def call(self, stage, *args):
        self.calls.append((stage, *args))
        if self.barrier and self.barrier[0] == stage:
            self.barrier[1].set()
            if not self.barrier[2].wait(5):
                raise RuntimeError('Test barrier timed out')
        if stage == self.fail:
            raise RuntimeError('Injected failure')

    def authenticate(self, token):
        if token not in self.identities:
            return {'active': False}
        return {'active': True, 'user_id': str(self.identities[token]),
                'phone_verified': True, 'phone_number': '+1555000000' + ('1' if token == 'a' else '2')}

    def assess(self, intent):
        self.call('assess', intent)
        return {'seconds': self.seconds, 'feedback': 'Split into individual topics.'}

    def evaluate(self, intent, video):
        self.call('evaluate', intent, video)
        return self.approved

    def deliver(self, job_id, phone, video):
        self.call('deliver', job_id, phone, video)
        return 'photon-message'


class Runtime:
    duration = 90
    fail = None

    def __init__(self):
        self.calls = []
        self.barrier = None

    def start(self, owner):
        self.calls.append(('start', owner))
        if self.fail == 'start':
            raise RuntimeError('Startup failed')
        return 'user-' + str(owner)

    def command(self, handle, action, job, payload=None):
        self.calls.append((action, handle, job, payload))
        if self.barrier and action == self.barrier[0]:
            self.barrier[1].set()
            if not self.barrier[2].wait(5):
                raise RuntimeError('Test barrier timed out')
        if action == self.fail:
            raise RuntimeError('Injected runtime failure')
        if action == 'render':
            return {'seconds': self.duration}
        return b'fixture-video' if action == 'video' else {}

    def stop(self, handle):
        self.calls.append(('stop', handle))


class BackendTests(unittest.TestCase):
    def setUp(self):
        database_url = os.environ.get('TEST_DATABASE_URL')
        self.engine = (create_engine(database_url) if database_url else
                       create_engine('sqlite://', connect_args={'check_same_thread': False}, poolclass=StaticPool))
        if database_url:
            Base.metadata.drop_all(self.engine)
        logging.getLogger('backend.service').disabled = True
        Base.metadata.create_all(self.engine)
        self.sessions = sessionmaker(self.engine, expire_on_commit=False)
        self.a, self.b = uuid.uuid4(), uuid.uuid4()
        self.now = datetime(2026, 1, 1, tzinfo=timezone.utc)
        self.dependencies, self.runtime = Boundaries(self.a, self.b), Runtime()
        self.service = Service(self.sessions, self.dependencies, self.runtime, lambda: self.now)
        self.client = TestClient(create_app(self.service, coordinator_guard=False))
        for token in ('a', 'b'):
            self.assertEqual(self.client.put('/account', headers=self.headers(token)).status_code, 200)

    def tearDown(self):
        self.client.close()
        self.engine.dispose()

    def headers(self, token='a'):
        return {'Authorization': 'Bearer ' + token}

    def submit(self, voiceover=False):
        response = self.client.post('/lessons', headers=self.headers(), json={'topic': 'Explain gravity', 'voiceover': voiceover})
        self.assertEqual(response.status_code, 202)
        return response.json()['id']

    def status(self, job):
        return self.client.get('/lessons/' + str(job), headers=self.headers()).json()

    def test_postgres_rejects_a_second_coordinator(self):
        if self.engine.dialect.name != 'postgresql':
            self.skipTest('Requires disposable PostgreSQL')
        with patch('backend.main.engine', self.engine):
            with TestClient(create_app(self.service, coordinator_guard=True)):
                with self.assertRaisesRegex(RuntimeError, 'exactly one'):
                    with TestClient(create_app(self.service, coordinator_guard=True)):
                        pass
            # Releasing the first coordinator makes a later startup usable.
            with TestClient(create_app(self.service, coordinator_guard=True)) as client:
                self.assertEqual(client.get('/openapi.json').status_code, 200)

    def test_registration_is_stable_and_phone_conflicts_are_rejected(self):
        result = self.client.put('/account', headers=self.headers()).json()
        self.assertEqual(result['id'], str(self.a))
        with self.assertRaises(ValueError):
            self.service.register(self.a, '+15551111111')

    def test_authentication_does_not_trigger_activity_or_work(self):
        self.now += timedelta(minutes=24)
        for token in (None, 'invalid', 'expired', 'revoked'):
            headers = {} if token is None else self.headers(token)
            for method, path in [('post', '/lessons'), ('get', '/lessons/' + str(uuid.uuid4()))]:
                response = getattr(self.client, method)(path, headers=headers, **({'json': {'topic': 'test'}} if method == 'post' else {}))
                self.assertEqual(response.status_code, 401)
        with self.sessions() as db:
            container = db.scalar(select(UserContainer).where(UserContainer.user_id == self.a))
            self.assertEqual(container.last_authenticated_request_at.minute, 0)
        self.assertEqual(self.runtime.calls, [])

    def test_scope_boundary(self):
        for seconds in (89, 90, 91):
            with self.subTest(seconds=seconds):
                self.dependencies.seconds = seconds
                before = len(self.runtime.calls)
                status = self.status(self.submit())
                self.assertEqual(status['status'], 'needs_breakdown' if seconds > 90 else 'accepted')
                if seconds > 90:
                    self.assertEqual(len(self.runtime.calls), before)
                    self.assertIn('Split', status['feedback'])

    def test_overlong_render_and_rejected_evaluation_do_not_deliver(self):
        for duration, approved in [(91, True), (90, False), (float('nan'), True)]:
            with self.subTest(duration=duration, approved=approved):
                self.runtime.duration, self.dependencies.approved = duration, approved
                before = len([c for c in self.dependencies.calls if c[0] == 'deliver'])
                self.assertEqual(self.status(self.submit())['status'], 'failed')
                self.assertEqual(len([c for c in self.dependencies.calls if c[0] == 'deliver']), before)
                self.assertEqual(self.runtime.calls[-1][0], 'cleanup')

    def test_pipeline_intent_owner_voiceover_and_acceptance(self):
        for voiceover in (True, False):
            job = self.submit(voiceover)
            status = self.status(job)
            self.assertTrue(status['photon_accepted'])
            self.assertEqual(status['status'], 'accepted')
            self.assertEqual(status['provider_message_id'], 'photon-message')
            generated = [c for c in self.runtime.calls if c[0] == 'generate'][-1]
            self.assertEqual(generated[1], 'user-' + str(self.a))
            self.assertEqual(generated[3], {'intent': 'Explain gravity', 'voiceover': voiceover})
            self.assertEqual(self.dependencies.calls[-1][2], '+15550000001')
            self.assertEqual(self.dependencies.calls[-2], ('evaluate', 'Explain gravity', b'fixture-video'))

    def test_ownership_and_forged_submission(self):
        job = self.submit()
        self.assertEqual(self.client.get('/lessons/' + job, headers=self.headers('b')).status_code, 404)
        self.assertEqual(self.client.get('/artifacts/' + job, headers=self.headers('b')).status_code, 404)
        before = len(self.runtime.calls)
        self.assertEqual(self.client.post('/lessons', headers=self.headers(), json={'topic': 'test', 'user_id': str(self.b)}).status_code, 422)
        self.assertEqual(len(self.runtime.calls), before)

    def test_inactivity_boundary_and_refresh(self):
        self.submit()
        self.now += timedelta(minutes=24, seconds=59)
        self.service.sweep()
        self.assertFalse(any(c[0] == 'stop' for c in self.runtime.calls))
        self.now += timedelta(seconds=2)
        self.service.sweep()
        self.assertEqual(self.runtime.calls[-1][0], 'stop')
        self.submit()
        self.now += timedelta(minutes=24)
        self.client.get('/lessons/' + str(uuid.uuid4()), headers=self.headers())
        self.now += timedelta(minutes=1, seconds=1)
        before = len(self.runtime.calls)
        self.service.sweep()
        self.assertEqual(len(self.runtime.calls), before)

    def test_active_stages_allow_polling_and_protect_container(self):
        for stage in ('generate', 'render', 'evaluate', 'deliver'):
            with self.subTest(stage=stage):
                entered, release = threading.Event(), threading.Event()
                target = self.runtime if stage in ('generate', 'render') else self.dependencies
                target.barrier = (stage, entered, release)
                job = self.service.submit(self.a, 'test')
                thread = threading.Thread(target=self.service.process, args=(self.a, job, False))
                thread.start()
                try:
                    self.assertTrue(entered.wait(5))
                    self.now += timedelta(minutes=26)
                    # This request must return while the pipeline is paused.
                    self.assertEqual(self.client.get('/lessons/' + str(job), headers=self.headers()).status_code, 200)
                    self.service.sweep()
                    self.assertFalse(any(c[0] == 'stop' for c in self.runtime.calls))
                finally:
                    release.set()
                    thread.join(5)
                    target.barrier = None
                self.assertFalse(thread.is_alive())

    def test_admitted_job_prevents_stop_and_stop_first_can_restart(self):
        self.submit()
        self.now += timedelta(minutes=26)
        job = self.service.submit(self.a, 'test')
        self.service.sweep()
        self.assertFalse(any(c[0] == 'stop' for c in self.runtime.calls))
        self.service.process(self.a, job, False)
        self.service.sweep()
        self.assertEqual(self.runtime.calls[-1][0], 'stop')
        self.submit()
        self.assertEqual(self.runtime.calls[-1][0], 'cleanup')

    def test_dependency_failures_are_contained(self):
        for boundary, stage in [(self.dependencies, 'assess'), (self.runtime, 'start'),
                                (self.runtime, 'generate'), (self.runtime, 'render'),
                                (self.runtime, 'video'), (self.dependencies, 'evaluate'),
                                (self.dependencies, 'deliver')]:
            with self.subTest(stage=stage):
                boundary.fail = stage
                status = self.status(self.submit())
                self.assertEqual(status['status'], 'failed')
                self.assertFalse(status['photon_accepted'])
                self.assertEqual(self.service.active[self.a], 0)
                boundary.fail = None

    def test_status_write_failure_does_not_advance_pipeline(self):
        original = self.service.update
        def update(job, status, **fields):
            if status == 'rendering':
                raise RuntimeError('Database unavailable')
            return original(job, status, **fields)
        with patch.object(self.service, 'update', side_effect=update):
            status = self.status(self.submit())
        self.assertEqual(status['status'], 'failed')
        self.assertFalse(any(c[0] == 'render' for c in self.runtime.calls))
        self.assertEqual(self.runtime.calls[-1][0], 'cleanup')

    def test_cleanup_failure_retains_active_protection(self):
        self.runtime.fail = 'cleanup'
        self.submit()
        self.now += timedelta(minutes=26)
        self.service.sweep()
        self.assertEqual(self.service.active[self.a], 1)
        self.assertFalse(any(c[0] == 'stop' for c in self.runtime.calls))
        self.runtime.fail = None
        self.service.sweep()
        self.assertEqual(self.service.active[self.a], 0)
        self.assertEqual(self.runtime.calls[-1][0], 'stop')


if __name__ == '__main__':
    unittest.main()
