"""Exercise the exact upgrade SQL with legacy account relationships on PostgreSQL."""
from pathlib import Path
import os
import unittest
import uuid
from sqlalchemy import create_engine


@unittest.skipUnless(os.environ.get('TEST_DATABASE_URL'), 'Requires disposable PostgreSQL')
class AccountMigrationTests(unittest.TestCase):
    def test_legacy_uuids_relationships_and_unverified_enrollment_are_preserved(self):
        engine = create_engine(os.environ['TEST_DATABASE_URL'])
        self.addCleanup(engine.dispose)
        schema = 'accounts_upgrade_' + uuid.uuid4().hex
        connection = engine.raw_connection()
        connection.driver_connection.autocommit = True
        root = Path(__file__).resolve().parents[1]
        try:
            with connection.cursor() as cursor:
                cursor.execute(f'CREATE SCHEMA {schema}')
                cursor.execute(f'SET search_path TO {schema}')
                cursor.execute((root / 'tests/fixtures/preauth.sql').read_text())
                user, container, job, delivery = [uuid.uuid4() for _ in range(4)]
                cursor.execute("INSERT INTO users(id,phone_number) VALUES (%s,'+15551234567')", (user,))
                cursor.execute("INSERT INTO user_containers(id,user_id,status) VALUES (%s,%s,'running')", (container, user))
                cursor.execute("INSERT INTO lesson_jobs(id,user_id,original_request,status) VALUES (%s,%s,'legacy topic','delivering')", (job, user))
                cursor.execute("INSERT INTO video_deliveries(id,lesson_job_id,status) VALUES (%s,%s,'pending')", (delivery, job))
                cursor.execute((root / 'migrations/001_delivery_acceptance.sql').read_text())
                cursor.execute((root / 'migrations/002_owned_auth_and_recovery.sql').read_text())
                cursor.execute((root / 'migrations/003_account_deletion.sql').read_text())
                cursor.execute('SELECT deletion_requested_at FROM users')
                self.assertIsNone(cursor.fetchone()[0])
                cursor.execute('SELECT id,phone_number,password_hash,phone_verified_at,enrollment_hash FROM users')
                self.assertEqual(cursor.fetchone(), (user, '+15551234567', None, None, None))
                cursor.execute('SELECT id,user_id FROM user_containers')
                self.assertEqual(cursor.fetchone(), (container, user))
                cursor.execute('SELECT id,user_id,status,cleanup_required FROM lesson_jobs')
                self.assertEqual(cursor.fetchone(), (job, user, 'delivering', True))
                cursor.execute('SELECT id,lesson_job_id,recipient_phone,read_at FROM video_deliveries')
                self.assertEqual(cursor.fetchone(), (delivery, job, None, None))
                for table in ('auth_sessions', 'auth_tokens', 'auth_verifications', 'auth_rates'):
                    cursor.execute(f'SELECT count(*) FROM {table}')
                    self.assertEqual(cursor.fetchone()[0], 0)
        finally:
            connection.rollback()
            with connection.cursor() as cursor:
                cursor.execute('SET search_path TO public')
                cursor.execute(f'DROP SCHEMA IF EXISTS {schema} CASCADE')
            connection.close()
