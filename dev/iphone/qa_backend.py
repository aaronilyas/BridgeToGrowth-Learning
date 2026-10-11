#!/usr/bin/env python3
"""Physical-device QA: real FastAPI/auth/jobs/PostgreSQL, substituted providers.

No production database, Docker runtime, Gemini, Photon, generated code or video.
The operator runs this locally; controls bind to loopback and are never forwarded.
"""
import argparse
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import secrets
import signal
import subprocess
import sys
import threading
import time
import uuid

ROOT = Path(__file__).resolve().parents[2]
LOCAL = ROOT / '.local/iphone-testing'


def docker(*args):
    return subprocess.check_output(['docker', *args], stderr=subprocess.PIPE, text=True).strip()


def serve(port):
    name = 'btg-iphone-qa-' + uuid.uuid4().hex
    password = secrets.token_hex(32)
    docker('run', '-d', '--name', name, '--label', 'btg.iphone-qa=true',
           '--tmpfs', '/var/lib/postgresql/data:rw', '-p', '127.0.0.1::5432',
           '-e', 'POSTGRES_PASSWORD=' + password, '-e', 'POSTGRES_DB=btg',
           'postgres:17-bookworm')
    try:
        for _ in range(100):
            if subprocess.run(['docker', 'exec', name, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres'],
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0:
                break
            time.sleep(.2)
        else:
            raise RuntimeError('Disposable QA PostgreSQL did not start')
        info = json.loads(docker('inspect', name))[0]
        db_port = info['NetworkSettings']['Ports']['5432/tcp'][0]['HostPort']
        # Override, never inherit the operator's real database or provider config.
        os.environ['DATABASE_URL'] = f'postgresql+psycopg://postgres:{password}@127.0.0.1:{db_port}/btg'
        sys.path.insert(0, str(ROOT))
        import uvicorn
        from fastapi import HTTPException, Request
        from fastapi.responses import JSONResponse
        from sqlalchemy import select
        from backend.auth import Accounts
        from backend.database import SessionLocal, engine
        from backend.main import create_app
        from backend.models import Base, LessonJob
        from backend.service import Service

        Base.metadata.create_all(engine)
        lock = threading.RLock()
        state = {'offset': 0, 'codes': {}, 'requests': [], 'fault': None, 'delay': 0}

        def clock():
            return datetime.now(timezone.utc) + timedelta(seconds=state['offset'])

        class Providers:
            def verification(self, phone, code):
                with lock:
                    state['codes'][phone] = code  # Memory only; never logged.

            def assess(self, intent):
                time.sleep(1)
                return {'seconds': 120 if 'QA:overlong' in intent else 45,
                        'feedback': 'Split this request into smaller topics.'}

            def evaluate(self, intent, video, voiceover=False):
                return {'approved': True, 'accurate': True, 'defect_free': True,
                        'consistent': True, 'findings': 'Synthetic QA evaluation; no provider called.'}

            def deliver(self, job_id, phone, video):
                with SessionLocal() as db:
                    if 'QA:unknown' in db.get(LessonJob, job_id).original_request:
                        raise RuntimeError('Synthetic ambiguous acceptance')
                return 'qa-substitute-' + str(job_id)

        class Runtime:
            def start(self, owner):
                return 'qa-substitute-' + str(owner)

            def state(self, owner):
                return {'handle': None, 'running': False, 'busy': False}

            def stop(self, handle):
                pass

            def command(self, handle, action, job_id, payload=None):
                if action in ('generate', 'render'):
                    with SessionLocal() as db:
                        intent = db.get(LessonJob, job_id).original_request
                    if 'QA:failed' in intent:
                        raise RuntimeError('Synthetic renderer failure')
                    # Delay only, no generated source or real rendering executes.
                    time.sleep(3 if action == 'generate' else 8)
                if action == 'render':
                    return {'seconds': 45, 'has_audio': True}
                if action == 'video':
                    return b'synthetic-qa-bytes-not-a-real-video'
                return {}

        providers = Providers()
        service = Service(SessionLocal, providers, Runtime(), clock)
        accounts = Accounts(SessionLocal, providers, secrets.token_hex(32), clock)
        app = create_app(service, coordinator_guard=True, accounts=accounts, receipt_secret=secrets.token_hex(32))

        @app.middleware('http')
        async def evidence(request, call_next):
            if request.url.path.startswith('/__qa'):
                return await call_next(request)
            if state['delay']:
                import asyncio
                await asyncio.sleep(state['delay'])
            fault = state['fault']
            if fault and request.url.path == fault['path']:
                state['fault'] = {**fault, 'times': fault['times'] - 1} if fault.get('times', 1) > 1 else None
                response = JSONResponse(fault.get('body', {'detail': 'Synthetic QA outage'}),
                                        status_code=fault.get('status', 503), headers={'Cache-Control': 'no-store'})
            else:
                response = await call_next(request)
            response.headers['X-BTG-QA'] = 'providers-substituted'
            with lock:
                state['requests'].append({'at': time.time(), 'method': request.method,
                                          'path': request.url.path, 'status': response.status_code})
            return response

        # Request must be available globally for FastAPI's annotation evaluation.
        globals()['Request'] = Request

        @app.post('/__qa/control')
        async def control(request: Request):
            if request.client.host != '127.0.0.1':
                raise HTTPException(403)
            body = await request.json()
            with lock:
                state['offset'] += body.get('advance_seconds', 0)
                if 'fault' in body:
                    state['fault'] = body['fault']
                if 'delay' in body:
                    state['delay'] = body['delay']
                result = {'requests': list(state['requests'])}
                if 'phone' in body:
                    result['code'] = state['codes'].get(body['phone'])
            with SessionLocal() as db:
                result['jobs'] = [{'id': str(j.id), 'status': j.status, 'topic': j.original_request}
                                  for j in db.scalars(select(LessonJob).order_by(LessonJob.created_at))]
            return result

        LOCAL.mkdir(parents=True, exist_ok=True)
        meta = LOCAL / 'qa-backend.json'
        meta.write_text(json.dumps({'port': port, 'container': name, 'providers': 'substituted'}) + '\n')
        meta.chmod(0o600)
        print(f'QA FastAPI loopback port {port}; fresh tmpfs PostgreSQL; all providers substituted.', flush=True)
        class QAServer(uvicorn.Server):
            @contextmanager
            def capture_signals(self):
                # Uvicorn re-raises SIGTERM after draining; suppress that re-raise
                # here so the finally block can remove this disposable database.
                previous = {s: signal.signal(s, self.handle_exit) for s in (signal.SIGINT, signal.SIGTERM)}
                try:
                    yield
                finally:
                    for s, handler in previous.items():
                        signal.signal(s, handler)

        QAServer(uvicorn.Config(app, host='127.0.0.1', port=port, access_log=False,
                               log_level='warning', proxy_headers=False)).run()
    finally:
        # This process owns only this disposable database, never a user renderer.
        docker('rm', '-f', name)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=8001)
    serve(parser.parse_args().port)
