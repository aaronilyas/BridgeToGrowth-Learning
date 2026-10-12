"""Durable admission/deletion obligations with injected runtime and providers."""
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
import threading
from unittest.mock import Mock, patch

from sqlalchemy import select

import unittest
import test_backend
from backend.auth import PASSWORDS
from backend.models import LessonJob, ReceiptEvent, User, AuthSession, AuthToken
from backend.service import AdmissionLimited, Conflict, Service

PASSWORD = 'disposable deletion password'


class LifecycleTests(unittest.TestCase):
    tearDown = test_backend.BackendTests.tearDown
    headers = test_backend.BackendTests.headers
    # Reuse fixtures only; base contract tests continue running in their own module.
    def setUp(self):
        test_backend.BackendTests.setUp(self)
        self.runtime.remove = Mock()
        with self.sessions() as db:
            db.get(User, self.a).password_hash = PASSWORDS.hash(PASSWORD)
            db.commit()

    def delete(self, status=202, password=PASSWORD, token='a'):
        response = self.client.post('/account/delete', headers=self.headers(token), json={'password': password})
        self.assertEqual(response.status_code, status, response.text)
        return response

    def test_window_limits_retry_after_idempotency_and_restart(self):
        self.service.request_limit = 2
        self.service.request_window = 60
        first = self.service.submit(self.a, 'one', idempotency_key='one')
        self.service.process(self.a, first)
        self.now += timedelta(seconds=10)
        second = self.service.submit(self.a, 'two')
        self.service.process(self.a, second)
        self.now += timedelta(seconds=1)
        with patch.object(self.service, 'process') as process:
            retry = self.client.post('/lessons', headers={**self.headers(), 'Idempotency-Key': 'one'}, json={'topic': 'one'})
            self.assertEqual(retry.status_code, 202)
            process.assert_not_called()
            response = self.client.post('/lessons', headers=self.headers(), json={'topic': 'three'})
            self.assertEqual(response.status_code, 429)
            self.assertEqual(response.headers['Retry-After'], '49')
            self.assertIn('allowance', response.json()['detail'])
            self.assertEqual(response.headers['Cache-Control'], 'no-store')
        replacement = Service(self.sessions, self.dependencies, self.runtime, lambda: self.now)
        replacement.request_limit, replacement.request_window = 2, 60
        with self.assertRaises(AdmissionLimited):
            replacement.submit(self.a, 'three')
        self.now += timedelta(seconds=49)
        self.assertIsNotNone(replacement.submit(self.a, 'three'))
        with self.sessions() as db:
            self.assertEqual(len(list(db.scalars(select(LessonJob)))), 3)

    def test_pending_active_global_limits_and_failed_cleanup(self):
        self.service.account_job_limit = 1
        self.service.global_job_limit = 2
        first = self.service.submit(self.a, 'one')
        with self.assertRaisesRegex(AdmissionLimited, 'Account pending/active'):
            self.service.submit(self.a, 'two')
        second = self.service.submit(self.b, 'one')
        with self.assertRaisesRegex(AdmissionLimited, 'Global'):
            self.service.submit(self.b, 'two')
        self.runtime.fail = 'cleanup'
        self.service.process(self.a, first)
        with self.sessions() as db:
            self.assertTrue(db.get(LessonJob, first).cleanup_required)
        replacement = Service(self.sessions, self.dependencies, self.runtime, lambda: self.now)
        replacement.global_job_limit = 2
        with self.assertRaisesRegex(AdmissionLimited, 'Global'):
            replacement.submit(self.b, 'two')
        with self.assertRaises(Conflict):
            replacement.submit(self.a, 'two')
        self.runtime.fail = None
        self.service.sweep()
        self.service.process(self.b, second)
        self.assertIsNotNone(self.service.submit(self.a, 'two'))

    def test_concurrent_accounts_share_atomic_global_admission(self):
        self.service.global_job_limit = 1
        barrier = threading.Barrier(2)
        def submit(owner):
            barrier.wait(timeout=5)
            try:
                return self.service.submit(owner, 'concurrent')
            except AdmissionLimited:
                return None
        with ThreadPoolExecutor(2) as pool:
            results = list(pool.map(submit, (self.a, self.b)))
        self.assertEqual(sum(result is not None for result in results), 1)
        with self.sessions() as db:
            self.assertEqual(len(list(db.scalars(select(LessonJob)))), 1)

    def test_deletion_requires_bearer_and_confirmation_and_revokes_all_sessions(self):
        self.delete(401, token='forged')
        self.delete(401, password='wrong password for deletion')
        with self.sessions() as db:
            self.assertIsNone(db.get(User, self.a).deletion_requested_at)
        self.delete()
        self.delete()  # revoked token may retry this endpoint only while unexpired
        self.assertEqual(self.client.get('/account', headers=self.headers()).status_code, 401)
        self.assertEqual(self.client.post('/lessons', headers=self.headers(), json={'topic': 'new'}).status_code, 401)
        with self.assertRaises(Conflict):
            self.service.submit(self.a, 'new')
        with self.sessions() as db:
            self.assertTrue(all(session.revoked_at for session in db.scalars(select(AuthSession).where(AuthSession.user_id == self.a))))
        self.service.sweep()
        self.runtime.remove.assert_called_once_with(self.a)
        self.delete(401)
        with self.sessions() as db:
            self.assertIsNone(db.get(User, self.a))
            self.assertIsNotNone(db.get(User, self.b))
            self.assertEqual(len(list(db.scalars(select(AuthToken)))), 2)  # other user's access + refresh

    def test_active_deletion_drains_and_cancels_queued_work(self):
        entered, release = threading.Event(), threading.Event()
        self.dependencies.barrier = ('assess', entered, release)
        first = self.service.submit(self.a, 'active')
        queued = self.service.submit(self.a, 'queued')
        worker = threading.Thread(target=self.service.process, args=(self.a, first))
        worker.start()
        try:
            self.assertTrue(entered.wait(5))
            self.delete()
            self.service.sweep()
            self.runtime.remove.assert_not_called()
            self.assertFalse(any(c[0] in ('stop', 'cancel') for c in self.runtime.calls))
            with self.sessions() as db:
                self.assertTrue(db.get(LessonJob, queued).cancel_requested)
                self.assertIsNotNone(db.get(User, self.a))
        finally:
            release.set()
            worker.join(10)
        self.assertFalse(worker.is_alive())
        self.service.process(self.a, queued)
        self.assertEqual(self.service.status(self.a, first)['status'], 'accepted')
        self.assertEqual(self.service.status(self.a, queued)['status'], 'cancelled')
        self.assertEqual(sum(c[0] == 'deliver' for c in self.dependencies.calls), 1)
        self.service.sweep()
        self.runtime.remove.assert_called_once_with(self.a)

    def test_failed_removal_interruption_recovery_and_late_receipt_isolation(self):
        job = self.service.submit(self.a, 'topic')
        self.service.process(self.a, job)
        self.service.receipt('receipt-a', 'photon-message-' + str(job), '+15550000001', self.now)
        self.service.receipt('receipt-b', 'other-message', '+15550000002', self.now)
        self.delete()
        self.runtime.remove.side_effect = RuntimeError('injected cleanup failure')
        self.service.sweep()
        with self.sessions() as db:
            self.assertIsNotNone(db.get(User, self.a))
            self.assertIsNotNone(db.get(ReceiptEvent, 'receipt-a'))
        replacement = Service(self.sessions, self.dependencies, self.runtime, lambda: self.now)
        replacement.reconcile()
        with self.sessions() as db:
            self.assertIsNotNone(db.get(User, self.a))
        self.runtime.remove.side_effect = None
        replacement.reconcile()
        replacement.receipt('late-a', 'photon-message-' + str(job), '+15550000001', self.now)
        with self.sessions() as db:
            self.assertIsNone(db.get(User, self.a))
            self.assertIsNone(db.get(ReceiptEvent, 'receipt-a'))
            self.assertIsNone(db.get(ReceiptEvent, 'late-a'))
            self.assertIsNotNone(db.get(ReceiptEvent, 'receipt-b'))
            self.assertIsNotNone(db.get(User, self.b))

    def test_interrupted_queued_deletion_and_busy_runtime_restart(self):
        queued = self.service.submit(self.a, 'queued')
        self.delete()
        replacement = Service(self.sessions, self.dependencies, self.runtime, lambda: self.now)
        with patch.object(self.runtime, 'state', return_value={'handle': 'owned', 'running': True, 'busy': True}):
            replacement.reconcile()
        self.runtime.remove.assert_not_called()
        with self.sessions() as db:
            self.assertTrue(db.get(LessonJob, queued).cancel_requested)
        replacement.reconcile()
        self.runtime.remove.assert_called_once_with(self.a)
        with self.sessions() as db:
            self.assertIsNone(db.get(User, self.a))

    def test_receipt_metadata_expiry_boundary(self):
        self.service.receipt('old', 'message-old', '+15550000002', self.now)
        self.now += timedelta(days=7) - timedelta(microseconds=1)
        self.service.sweep()
        with self.sessions() as db:
            self.assertIsNotNone(db.get(ReceiptEvent, 'old'))
        self.now += timedelta(microseconds=1)
        self.service.sweep()
        with self.sessions() as db:
            self.assertIsNone(db.get(ReceiptEvent, 'old'))

    def test_forwarded_headers_do_not_split_auth_throttle(self):
        for index in range(11):
            response = self.client.post('/auth/login', headers={'X-Forwarded-For': f'192.0.2.{index}', 'CF-Connecting-IP': f'192.0.2.{index}'},
                                        json={'phone_number': '+15550000001', 'password': 'wrong password value'})
            self.assertEqual(response.status_code, 401 if index < 10 else 429)

    def test_shutdown_waits_for_recovered_active_runtime_without_force_kill(self):
        queued = self.service.submit(self.a, 'interrupted')
        busy = threading.Event()
        busy.set()
        observed = threading.Event()
        def state(owner):
            observed.set()
            return {'handle': 'owned-' + str(owner), 'running': True, 'busy': busy.is_set()}
        with patch.object(self.runtime, 'state', side_effect=state):
            drain = threading.Thread(target=self.service.drain)
            drain.start()
            try:
                self.assertTrue(observed.wait(5))
                self.assertTrue(drain.is_alive())
                self.assertFalse(any(c[0] == 'stop' for c in self.runtime.calls))
            finally:
                busy.clear()
                drain.join(10)
            self.assertFalse(drain.is_alive())
        self.assertEqual(self.service.status(self.a, queued)['status'], 'interrupted')

    def test_deletion_failed_job_cleanup_keeps_rows_and_capacity_until_retry(self):
        job = self.service.submit(self.a, 'topic')
        self.runtime.fail = 'cleanup'
        self.service.process(self.a, job)
        self.delete()
        self.service.sweep()
        self.runtime.remove.assert_not_called()
        with self.sessions() as db:
            self.assertIsNotNone(db.get(User,self.a))
            self.assertTrue(db.get(LessonJob,job).cleanup_required)
        self.runtime.fail = None
        self.service.sweep()
        self.runtime.remove.assert_called_once_with(self.a)
        with self.sessions() as db:
            self.assertIsNone(db.get(User,self.a))

    def test_active_work_holds_account_and_global_capacity_across_accounts(self):
        entered,release=threading.Event(),threading.Event()
        self.dependencies.barrier=('assess',entered,release)
        self.service.account_job_limit=1
        self.service.global_job_limit=2
        job=self.service.submit(self.a,'active')
        worker=threading.Thread(target=self.service.process,args=(self.a,job))
        worker.start()
        try:
            self.assertTrue(entered.wait(5))
            with self.assertRaisesRegex(AdmissionLimited,'Account pending/active'):
                self.service.submit(self.a,'over account limit')
            other=self.service.submit(self.b,'queued')
            with self.assertRaisesRegex(AdmissionLimited,'Global'):
                self.service.submit(self.b,'over global limit')
        finally:
            release.set()
            worker.join(10)
        self.assertFalse(worker.is_alive())
        self.service.process(self.b,other)
        self.assertIsNotNone(self.service.submit(self.a,'released'))
