"""Acceptance persistence and polling regressions; no Photon calls or video files."""
from datetime import timedelta
from pathlib import Path
import os
import threading
import unittest
import uuid
from unittest.mock import patch

from sqlalchemy import create_engine, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

import test_backend as fixtures
from backend.models import LessonJob, VideoDelivery


class DeliverySemanticsTests(unittest.TestCase):
    setUp = fixtures.BackendTests.setUp
    tearDown = fixtures.BackendTests.tearDown
    headers = fixtures.BackendTests.headers
    submit = fixtures.BackendTests.submit
    status = fixtures.BackendTests.status

    def test_acceptance_completes_job_and_attempt_together(self):
        job_id = uuid.UUID(self.submit())
        with self.sessions() as db:
            job = db.get(LessonJob, job_id)
            delivery = db.scalar(select(VideoDelivery).where(VideoDelivery.lesson_job_id == job_id))
            self.assertEqual(job.status, 'accepted')
            self.assertEqual(delivery.status, 'accepted')
            self.assertEqual(job.completed_at, delivery.accepted_at)
            self.assertIsNotNone(job.completed_at)
            self.assertEqual(delivery.provider_message_id, 'photon-message')
            self.assertIsNone(delivery.delivered_at)
        self.assertEqual(self.status(job_id), {
            'id': str(job_id), 'status': 'accepted', 'estimated_duration_seconds': 90,
            'feedback': None, 'failure_reason': None, 'photon_accepted': True,
            'provider_message_id': 'photon-message',
        })
        self.now += timedelta(minutes=26)
        self.service.sweep()
        self.assertEqual(self.runtime.calls[-1][0], 'stop')

    def test_polling_during_send_does_not_claim_acceptance(self):
        entered, release = threading.Event(), threading.Event()
        self.dependencies.barrier = ('deliver', entered, release)
        job_id = self.service.submit(self.a, 'test')
        worker = threading.Thread(target=self.service.process, args=(self.a, job_id, False))
        worker.start()
        try:
            self.assertTrue(entered.wait(5))
            result = self.status(job_id)
            self.assertEqual(result['status'], 'delivering')
            self.assertFalse(result['photon_accepted'])
            self.assertIsNone(result['provider_message_id'])
            with self.sessions() as db:
                self.assertIsNone(db.get(LessonJob, job_id).completed_at)
        finally:
            release.set()
            worker.join(5)
        self.assertFalse(worker.is_alive())
        self.assertEqual(self.status(job_id)['status'], 'accepted')

    def test_rejection_and_timeout_leave_acceptance_unconfirmed_without_retry(self):
        for error in (RuntimeError('Rejected'), TimeoutError('Acceptance unknown')):
            with self.subTest(error=error), patch.object(self.dependencies, 'deliver', side_effect=error) as send:
                job_id = uuid.UUID(self.submit())
                send.assert_called_once()
                result = self.status(job_id)
                self.assertEqual(result['status'], 'failed')
                self.assertFalse(result['photon_accepted'])
                self.assertIsNone(result['provider_message_id'])
                with self.sessions() as db:
                    job = db.get(LessonJob, job_id)
                    delivery = job.deliveries[0]
                    self.assertIsNotNone(job.completed_at)
                    self.assertEqual(delivery.status, 'failed')
                    self.assertEqual(delivery.failure_reason, 'Acceptance not confirmed')
                    self.assertIsNone(delivery.accepted_at)
                    self.assertIsNone(delivery.delivered_at)
                self.assertEqual(self.runtime.calls[-1][0], 'cleanup')

    def test_acceptance_commit_failure_rolls_back_both_records(self):
        commit = Session.commit
        observed = []

        def fail_acceptance(db):
            attempts = [obj for obj in db.identity_map.values() if isinstance(obj, VideoDelivery) and obj.status == 'accepted']
            if attempts:
                job = db.get(LessonJob, attempts[0].lesson_job_id)
                observed.append((job.status, job.completed_at == attempts[0].accepted_at))
                raise RuntimeError('Acceptance transaction unavailable')
            return commit(db)

        with patch.object(Session, 'commit', fail_acceptance):
            job_id = uuid.UUID(self.submit())
        self.assertEqual(observed, [('accepted', True)])
        result = self.status(job_id)
        self.assertEqual(result['status'], 'failed')
        self.assertFalse(result['photon_accepted'])
        with self.sessions() as db:
            delivery = db.get(LessonJob, job_id).deliveries[0]
            self.assertEqual(delivery.status, 'failed')
            self.assertIsNone(delivery.accepted_at)
            self.assertIsNone(delivery.provider_message_id)

    def test_models_reject_unsupported_delivered_status(self):
        job_id = uuid.UUID(self.submit())
        for model in (LessonJob, VideoDelivery):
            with self.subTest(model=model), self.sessions() as db:
                obj = (db.get(LessonJob, job_id) if model is LessonJob else
                       db.scalar(select(VideoDelivery).where(VideoDelivery.lesson_job_id == job_id)))
                obj.status = 'delivered'
                with self.assertRaises(IntegrityError):
                    db.commit()
                db.rollback()


@unittest.skipUnless(os.environ.get('TEST_DATABASE_URL'), 'Requires disposable PostgreSQL')
class DeliveryMigrationTests(unittest.TestCase):
    def test_postgres_migration_preserves_evidence_and_rejects_old_statuses(self):
        engine = create_engine(os.environ['TEST_DATABASE_URL'])
        self.addCleanup(engine.dispose)
        if engine.dialect.name != 'postgresql':
            self.skipTest('Requires PostgreSQL')
        from psycopg.errors import CheckViolation

        schema_name = 'delivery_test_' + uuid.uuid4().hex
        root = Path(__file__).resolve().parents[1]
        # Reconstruct the initial schema constraints; the remaining columns are unchanged.
        old_schema = (root / 'schema.sql').read_text().replace(
            "'delivering', 'accepted', 'failed'", "'delivering', 'delivered', 'failed'").replace(
            "'pending', 'accepted', 'failed'", "'pending', 'accepted', 'delivered', 'failed'")
        connection = engine.raw_connection()
        connection.driver_connection.autocommit = True
        try:
            with connection.cursor() as cursor:
                cursor.execute(f'CREATE SCHEMA {schema_name}')
                cursor.execute(f'SET search_path TO {schema_name}')
                cursor.execute(old_schema)
                owner = uuid.uuid4()
                cursor.execute('INSERT INTO users (id, phone_number) VALUES (%s, %s)', (owner, '+15550000001'))
                cases = [('accepted', 'message', True, 'accepted', 'delivered'),
                         ('delivered', 'legacy-message', True, 'accepted', 'delivered'),
                         ('delivered', None, False, 'failed', 'delivered'),
                         ('pending', None, False, 'failed', 'delivered'),
                         ('accepted', '   ', True, 'failed', 'delivered'),
                         ('accepted', 'partial-acceptance', True, 'accepted', 'delivering'),
                         ('accepted', 'post-acceptance-failure', True, 'accepted', 'failed'),
                         ('pending', None, False, 'delivering', 'delivering')]
                jobs = []
                for status, message, timestamp, expected, job_status in cases:
                    job, attempt = uuid.uuid4(), uuid.uuid4()
                    jobs.append((job, attempt, expected))
                    cursor.execute("INSERT INTO lesson_jobs (id, user_id, original_request, status, completed_at) VALUES (%s, %s, 'test', %s, now())", (job, owner, job_status))
                    cursor.execute("INSERT INTO video_deliveries (id, lesson_job_id, status, provider_message_id, accepted_at) VALUES (%s, %s, %s, %s, CASE WHEN %s THEN now() END)", (attempt, job, status, message, timestamp))
                cursor.execute('SELECT id, completed_at FROM lesson_jobs ORDER BY id')
                before = cursor.fetchall()
                cursor.execute((root / 'migrations/001_delivery_acceptance.sql').read_text())
                cursor.execute('SELECT id, completed_at FROM lesson_jobs ORDER BY id')
                self.assertEqual(cursor.fetchall(), before)
                for job, attempt, expected in jobs:
                    cursor.execute('SELECT status FROM lesson_jobs WHERE id = %s', (job,))
                    self.assertEqual(cursor.fetchone()[0], expected)
                cursor.execute("SELECT status, provider_message_id, accepted_at FROM video_deliveries WHERE id = %s", (jobs[1][1],))
                status, message, accepted_at = cursor.fetchone()
                self.assertEqual((status, message), ('accepted', 'legacy-message'))
                self.assertIsNotNone(accepted_at)
                cursor.execute('SELECT status FROM video_deliveries WHERE id = %s', (jobs[2][1],))
                self.assertEqual(cursor.fetchone()[0], 'failed')
                cursor.execute('SELECT status FROM video_deliveries WHERE id = %s', (jobs[4][1],))
                self.assertEqual(cursor.fetchone()[0], 'failed')
                cursor.execute('SELECT status FROM video_deliveries WHERE id = %s', (jobs[3][1],))
                self.assertEqual(cursor.fetchone()[0], 'pending')
                for table, record in [('lesson_jobs', jobs[0][0]), ('video_deliveries', jobs[0][1])]:
                    with self.assertRaises(CheckViolation) as error:
                        cursor.execute(f"UPDATE {table} SET status = 'delivered' WHERE id = %s", (record,))
                    self.assertEqual(error.exception.sqlstate, '23514')
        finally:
            connection.rollback()
            with connection.cursor() as cursor:
                cursor.execute('SET search_path TO public')
                cursor.execute(f'DROP SCHEMA IF EXISTS {schema_name} CASCADE')
            connection.close()


if __name__ == '__main__':
    unittest.main()
