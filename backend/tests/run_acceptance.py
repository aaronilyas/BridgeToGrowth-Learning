"""Run required tests against a NEW tmpfs PostgreSQL container, never a supplied DB."""
from pathlib import Path
import json
import os
import subprocess
import sys
import time
import unittest
import uuid

ROOT = Path(__file__).resolve().parents[2]


def docker(*args, data=None):
    return subprocess.run(['docker', *args], input=data, capture_output=True, check=True, timeout=120).stdout


def main():
    os.chdir(ROOT)
    name = 'btg-acceptance-db-' + uuid.uuid4().hex
    try:
        docker('run', '-d', '--name', name, '--label', 'btg.acceptance=true',
               '--tmpfs', '/var/lib/postgresql/data:rw', '-p', '127.0.0.1::5432',
               '-e', 'POSTGRES_PASSWORD=synthetic-only', '-e', 'POSTGRES_DB=btg',
               'postgres:17-bookworm')
        deadline = time.monotonic() + 60
        while subprocess.run(['docker', 'exec', name, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres'],
                             capture_output=True).returncode:
            if time.monotonic() > deadline:
                raise RuntimeError('Disposable PostgreSQL readiness timed out')
            time.sleep(.2)
        docker('exec', '-i', name, 'psql', '-U', 'postgres', '-d', 'btg', '-v', 'ON_ERROR_STOP=1',
               data=(ROOT / 'backend/schema.sql').read_bytes())
        # Test the SQL fresh schema before unit fixtures replace it with ORM metadata.
        docker('exec', '-i', name, 'psql', '-U', 'postgres', '-d', 'btg', '-v', 'ON_ERROR_STOP=1', data=b"""
BEGIN;
INSERT INTO users(id, phone_number) VALUES ('00000000-0000-0000-0000-000000000001', '+15550000001');
INSERT INTO lesson_jobs(id, user_id, original_request, status) VALUES (
'00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'test', 'accepted');
DO $$ BEGIN
 BEGIN
  UPDATE lesson_jobs SET status = 'delivered';
  RAISE EXCEPTION 'Fresh schema allows fabricated receipt';
 EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
ROLLBACK;
""")
        info = json.loads(docker('inspect', name))[0]
        port = info['NetworkSettings']['Ports']['5432/tcp'][0]['HostPort']
        os.environ['TEST_DATABASE_URL'] = f'postgresql+psycopg://postgres:synthetic-only@127.0.0.1:{port}/btg'
        os.environ['ACCEPTANCE_DB_CONTAINER'] = name
        os.environ['RUN_ARCHITECTURE_TESTS'] = '1'
        os.environ['RUN_VOICEOVER_CONTAINER_TESTS'] = '1'
        os.environ['VOICEOVER_TEST_IMAGE'] = os.environ.get('USER_CONTAINER_IMAGE', 'btg-renderer:acceptance')
        os.environ['USER_CONTAINER_IMAGE'] = os.environ['VOICEOVER_TEST_IMAGE']
        sys.path.insert(0, str(ROOT / 'backend/tests'))
        suite = unittest.defaultTestLoader.discover(str(ROOT / 'backend/tests'))
        result = unittest.TextTestRunner(verbosity=2).run(suite)
        if result.skipped:
            print('BLOCKED: required acceptance checks were skipped', file=sys.stderr)
        return 0 if result.wasSuccessful() and not result.skipped else 1
    finally:
        # Only this runner's unique disposable DB; user render jobs are owned by tests.
        docker('rm', '-f', name)


if __name__ == '__main__':
    sys.exit(main())
