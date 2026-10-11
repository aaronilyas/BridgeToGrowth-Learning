"""Deterministic cancellation, concurrent admission, crash recovery and signed receipts."""
from datetime import timedelta
import hashlib
import hmac
import json
import threading
import time
import unittest
import uuid
from unittest.mock import patch

from sqlalchemy import select

import test_backend as fixtures
from backend.models import LessonJob, UserContainer, VideoDelivery
from backend.service import Conflict, Service


class JobSecurityTests(unittest.TestCase):
    setUp = fixtures.BackendTests.setUp
    tearDown = fixtures.BackendTests.tearDown
    headers = fixtures.BackendTests.headers
    submit = fixtures.BackendTests.submit
    status = fixtures.BackendTests.status
    renew_access = fixtures.BackendTests.renew_access

    def test_concurrent_idempotency_is_account_scoped_and_compares_full_request(self):
        entered = threading.Barrier(9)
        outcomes, errors = [], []
        def call():
            try:
                entered.wait(5)
                outcomes.append(self.service.submit(self.a, 'topic', True, 'key', admission=True))
            except Exception as error:
                errors.append(error)
        workers = [threading.Thread(target=call) for _ in range(8)]
        for worker in workers:
            worker.start()
        entered.wait(5)
        for worker in workers:
            worker.join(5)
        self.assertEqual(errors, [])
        self.assertEqual(len({value[0] for value in outcomes}), 1)
        self.assertEqual(sum(created for _, created in outcomes), 1)
        self.assertEqual(self.service.active[self.a], 1)
        for topic, voiceover in [('different', True), ('topic', False)]:
            with self.assertRaises(Conflict):
                self.service.submit(self.a, topic, voiceover, 'key')
        self.assertNotEqual(self.service.submit(self.b, 'topic', True, 'key'), outcomes[0][0])

    def test_api_idempotency_returns_existing_without_another_send(self):
        headers = {**self.headers(), 'Idempotency-Key': 'mobile-request-1'}
        first = self.client.post('/lessons', headers=headers, json={'topic': 'topic'}).json()
        before = len(self.dependencies.calls)
        second = self.client.post('/lessons', headers=headers, json={'topic': 'topic'}).json()
        self.assertEqual(first['id'], second['id'])
        self.assertEqual(len(self.dependencies.calls), before)
        self.assertEqual(second['status'], 'accepted')
        self.assertEqual(self.client.post('/lessons', headers=headers, json={'topic': 'topic', 'voiceover': True}).status_code, 409)

    def test_cancellation_races_stop_before_delivery_and_clean_before_release(self):
        for stage in ('assess', 'generate', 'render', 'evaluate'):
            with self.subTest(stage=stage):
                entered, release = threading.Event(), threading.Event()
                target = self.runtime if stage in ('generate', 'render') else self.dependencies
                target.barrier = (stage, entered, release)
                job = self.service.submit(self.a, 'topic')
                before = len([c for c in self.dependencies.calls if c[0] == 'deliver'])
                worker = threading.Thread(target=self.service.process, args=(self.a, job))
                worker.start()
                try:
                    self.assertTrue(entered.wait(5))
                    self.assertEqual(self.client.post(f'/lessons/{job}/cancel', headers=self.headers('b')).status_code, 404)
                    response = self.client.post(f'/lessons/{job}/cancel', headers=self.headers())
                    self.assertEqual(response.status_code, 202)
                    self.assertTrue(response.json()['cancel_requested'])
                    self.assertEqual(self.service.active[self.a], 1)
                finally:
                    release.set()
                    worker.join(5)
                    target.barrier = None
                self.assertFalse(worker.is_alive())
                self.assertEqual(self.status(job)['status'], 'cancelled')
                self.assertFalse(self.status(job)['cleanup_pending'])
                self.assertEqual(self.service.active[self.a], 0)
                self.assertEqual(len([c for c in self.dependencies.calls if c[0] == 'deliver']), before)
                if stage in ('generate', 'render'):
                    self.assertTrue(any(c[0] == 'cancel' and c[2] == job for c in self.runtime.calls))
                    self.assertEqual(self.runtime.calls[-1][0], 'cleanup')

    def test_cancellation_cutoff_delivering_and_completed_message(self):
        entered, release = threading.Event(), threading.Event()
        self.dependencies.barrier = ('deliver', entered, release)
        job = self.service.submit(self.a, 'topic')
        worker = threading.Thread(target=self.service.process, args=(self.a, job))
        worker.start()
        try:
            self.assertTrue(entered.wait(5))
            self.assertEqual(self.client.post(f'/lessons/{job}/cancel', headers=self.headers()).status_code, 409)
        finally:
            release.set()
            worker.join(5)
        self.assertEqual(self.status(job)['status'], 'accepted')
        self.assertEqual(self.client.post(f'/lessons/{job}/cancel', headers=self.headers()).status_code, 409)

    def test_queued_cancellation_and_cleanup_failure_keep_protection(self):
        job = self.service.submit(self.a, 'topic')
        self.service.cancel(self.a, job)
        self.service.process(self.a, job)
        self.assertEqual(self.status(job)['status'], 'cancelled')
        self.assertEqual(self.runtime.calls, [])
        self.runtime.fail = 'cleanup'
        accepted = self.submit()
        with self.sessions() as db:
            self.assertTrue(db.get(LessonJob, uuid.UUID(accepted)).cleanup_required)
        self.assertEqual(self.service.active[self.a], 1)
        self.runtime.fail = None
        self.service.sweep()
        self.assertFalse(self.status(accepted)['cleanup_pending'])
        self.assertEqual(self.service.active[self.a], 0)

    def recovered(self, running=True, busy=False):
        state = {'handle': 'user-' + str(self.a) if running else None, 'running': running, 'busy': busy}
        self.runtime.state = lambda identity: state if identity == self.a else {'handle': None, 'running': False, 'busy': False}
        return Service(self.sessions, self.dependencies, self.runtime, lambda: self.now)

    def test_startup_preserves_actual_processes_then_recovers_and_restores_idle_cleanup(self):
        job = self.service.submit(self.a, 'topic')
        self.service.update(job, 'rendering', cleanup_required=True)
        recovery = self.recovered(busy=True)
        recovery.reconcile()
        self.assertEqual(recovery.status(self.a, job)['status'], 'rendering')
        self.assertEqual(self.runtime.calls, [])
        with self.assertRaises(Conflict):
            recovery.submit(self.a, 'new topic')
        self.runtime.state = lambda identity: {'handle': 'user-' + str(identity), 'running': True, 'busy': False}
        recovery.sweep()
        self.assertEqual(recovery.status(self.a, job)['status'], 'interrupted')
        self.assertFalse(recovery.status(self.a, job)['cleanup_pending'])
        self.now += timedelta(minutes=26)
        recovery.sweep()
        self.assertTrue(any(c[0] == 'stop' for c in self.runtime.calls))

    def test_recovery_pending_delivery_never_resends_and_committed_evidence_wins(self):
        for accepted in (False, True):
            job = self.service.submit(self.a, 'topic')
            self.service.update(job, 'delivering', cleanup_required=True)
            with self.sessions() as db:
                db.add(VideoDelivery(lesson_job_id=job, status='accepted' if accepted else 'pending',
                    provider_message_id=str(job) if accepted else None,
                    accepted_at=self.now if accepted else None, recipient_phone='+15550000001'))
                db.commit()
            recovery = self.recovered()
            recovery.reconcile()
            self.assertEqual(recovery.status(self.a, job)['status'], 'accepted' if accepted else 'delivery_unknown')
            self.assertFalse(any(c[0] == 'deliver' for c in self.dependencies.calls))

    def test_recovery_terminal_cleanup_obligation_survives_new_service(self):
        self.runtime.fail = 'cleanup'
        job = self.submit()
        recovery = self.recovered()
        recovery.reconcile()
        self.assertTrue(recovery.status(self.a, uuid.UUID(job))['cleanup_pending'])
        self.assertIn(self.a, recovery.recovering)
        self.runtime.fail = None
        recovery.sweep()
        self.assertFalse(recovery.status(self.a, uuid.UUID(job))['cleanup_pending'])
        self.assertEqual(recovery.active[self.a], 0)

    def test_recovery_missing_container_has_no_artifacts_and_unknown_runtime_retains_work(self):
        job = self.service.submit(self.a, 'topic')
        self.service.update(job, 'generating', cleanup_required=True)
        recovery = self.recovered(running=False)
        recovery.reconcile()
        self.assertEqual(recovery.status(self.a, job)['status'], 'interrupted')
        job2 = recovery.submit(self.a, 'next topic')
        self.runtime.state = lambda identity: (_ for _ in ()).throw(RuntimeError('daemon unavailable'))
        recovery.reconcile()
        self.assertEqual(recovery.status(self.a, job2)['status'], 'queued')
        self.assertIn(self.a, recovery.recovering)

    def signed(self, payload, timestamp=None, secret='receipt-test-' * 4):
        raw = json.dumps(payload).encode()
        timestamp = str(int(time.time()) if timestamp is None else timestamp)
        signature = hmac.new(secret.encode(), timestamp.encode() + b'.' + raw, hashlib.sha256).hexdigest()
        return raw, {'Content-Type': 'application/json', 'X-Receipt-Timestamp': timestamp, 'X-Receipt-Signature': signature}

    def send_receipt(self, payload, status=204, **kwargs):
        body, headers = self.signed(payload, **kwargs)
        result = self.client.post('/internal/receipts', content=body, headers=headers)
        self.assertEqual(result.status_code, status, result.text)

    def test_receipts_are_private_authenticated_duplicate_safe_and_out_of_order(self):
        job = self.submit()
        message_id = self.status(job)['provider_message_id']
        event = {'event_id': 'read-1', 'message_id': message_id, 'recipient': '+15550000001', 'read_at': self.now.isoformat()}
        self.send_receipt(event, 401, secret='forged-secret-' * 4)
        self.send_receipt(event, 401, timestamp=int(time.time()) - 301)
        self.assertEqual(self.status(job)['receipt_status'], 'unconfirmed')
        self.send_receipt({**event, 'recipient': '+15550000002', 'event_id': 'wrong-recipient'})
        self.assertEqual(self.status(job)['receipt_status'], 'unconfirmed')
        self.send_receipt(event)
        self.send_receipt(event)
        self.send_receipt({**event, 'read_at': (self.now + timedelta(seconds=2)).isoformat(), 'event_id': 'read-2'})
        self.send_receipt({**event, 'read_at': (self.now - timedelta(seconds=2)).isoformat(), 'event_id': 'read-0'})
        result = self.status(job)
        self.assertEqual(result['receipt_status'], 'read')
        self.assertEqual(result['read_at'], (self.now - timedelta(seconds=2)).isoformat())
        self.assertEqual(result['status'], 'accepted')
        self.send_receipt({**event, 'recipient': '+15550000002'}, 409)
        self.assertEqual(self.client.get('/lessons/' + job, headers=self.headers('b')).status_code, 404)

    def test_receipt_before_acceptance_is_applied_when_send_commits(self):
        job = self.service.submit(self.a, 'topic')
        message_id = 'photon-message-' + str(job)
        self.send_receipt({'event_id': 'early-read', 'message_id': message_id, 'recipient': '+15550000001', 'read_at': self.now.isoformat()})
        self.service.process(self.a, job)
        self.assertEqual(self.status(job)['receipt_status'], 'read')

    def test_evaluation_metadata_is_persisted_and_owner_visible(self):
        report = {'approved': False, 'accurate': False, 'defect_free': True, 'consistent': True, 'findings': 'The explanation reverses acceleration.'}
        with patch.object(self.dependencies, 'evaluate', return_value=report):
            job = self.submit()
        self.assertEqual(self.status(job)['evaluation'], report)
        self.assertEqual(self.status(job)['status'], 'failed')
        self.assertFalse(any(c[0] == 'deliver' for c in self.dependencies.calls))
