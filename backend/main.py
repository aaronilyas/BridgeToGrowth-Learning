"""Public account/lesson API; private signed messaging receipts."""
import asyncio
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
import hashlib
import hmac
import logging
import os
import time
import uuid

from fastapi import BackgroundTasks, Depends, FastAPI, Header, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, ConfigDict, Field, StrictBool
from sqlalchemy import text

from .auth import Accounts, invalid
from .config import validate_settings
from .database import SessionLocal, engine
from .integrations import Integrations
from .models import User
from .runtime import DockerRuntime
from .service import AdmissionLimited, Conflict, Service


class Body(BaseModel):
    model_config = ConfigDict(extra='forbid')


class Phone(Body):
    phone_number: str = Field(pattern=r'^\+[1-9][0-9]{7,14}$', max_length=16)


class Credentials(Phone):
    password: str = Field(min_length=12, max_length=128)


class DeleteAccount(Body):
    password: str = Field(min_length=12, max_length=128)


class Enrollment(Credentials):
    enrollment_token: str = Field(min_length=32, max_length=128)


class Code(Body):
    challenge_id: uuid.UUID
    code: str = Field(pattern=r'^[0-9]{6}$', max_length=6)


class RecoveryReset(Code):
    new_password: str = Field(min_length=12, max_length=128)


class Resend(Body):
    challenge_id: uuid.UUID


class Refresh(Body):
    refresh_token: str = Field(min_length=20, max_length=128)


class LessonRequest(Body):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)
    topic: str = Field(min_length=1, max_length=10000)
    voiceover: StrictBool = False


class Receipt(Body):
    event_id: str = Field(min_length=1, max_length=255)
    message_id: str = Field(min_length=1, max_length=255)
    recipient: str = Field(pattern=r'^\+[1-9][0-9]{7,14}$', max_length=16)
    read_at: datetime


def create_app(service=None, coordinator_guard=True, accounts=None, receipt_secret=None):
    production = service is None
    service = service or Service(SessionLocal, Integrations(), DockerRuntime())

    @asynccontextmanager
    async def lifespan(app):
        guard = None
        if production:
            validate_settings()
            from .check_schema import check_schema
            check_schema()
            app.state.accounts = Accounts(service.sessions, service.integrations, os.environ['AUTH_CODE_SECRET'], service.clock)
            app.state.receipt_secret = os.environ['RECEIPT_SECRET']
        if coordinator_guard:
            guard = engine.connect()
            if not guard.scalar(text('SELECT pg_try_advisory_lock(78264019)')):
                guard.close()
                raise RuntimeError('Run exactly one API worker/coordinator')
        try:
            await asyncio.to_thread(service.reconcile)
            async def cleanup():
                while True:
                    await asyncio.sleep(30)
                    try:
                        operation = asyncio.create_task(asyncio.to_thread(service.sweep))
                        try:
                            await asyncio.shield(operation)
                        except asyncio.CancelledError:
                            await operation  # Drain cleanup before releasing coordinator ownership.
                            raise
                    except Exception:
                        logging.getLogger(__name__).warning('Inactivity sweep failed')
            task = asyncio.create_task(cleanup())
            try:
                yield
            finally:
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass
        finally:
            if guard:
                guard.execute(text('SELECT pg_advisory_unlock(78264019)'))
                guard.close()

    app = FastAPI(lifespan=lifespan)
    app.state.service, app.state.accounts, app.state.receipt_secret = service, accounts, receipt_secret
    bearer = HTTPBearer(auto_error=False)

    @app.exception_handler(RequestValidationError)
    async def validation_error(request, error):
        # FastAPI's default echoes invalid input, including passwords/tokens/codes.
        return JSONResponse(status_code=422, content={'detail': [
            {'loc': e['loc'], 'type': e['type'], 'msg': e['msg']} for e in error.errors()]})

    @app.middleware('http')
    async def no_store(request, call_next):
        response = await call_next(request)
        response.headers['Cache-Control'] = 'no-store'
        return response

    def auth(request: Request):
        if request.app.state.accounts is None:
            raise HTTPException(503, 'Account service unavailable')
        return request.app.state.accounts

    def client(request: Request):
        # No trust in user-supplied forwarded headers. Dedicated proxy trust must be configured at the server.
        return request.client.host if request.client else 'unknown'

    def identity(credentials: HTTPAuthorizationCredentials | None = Depends(bearer), accounts=Depends(auth)):
        if not credentials:
            raise invalid()
        return accounts.resolve(credentials.credentials)

    def registered(account=Depends(identity)):
        if not service.touch(account[0]):
            raise invalid()
        return account

    @app.get('/healthz', include_in_schema=False)
    def health():
        with service.sessions() as db:
            db.execute(text('SELECT 1'))
        return {'status': 'ok'}

    @app.post('/account/delete', status_code=202)
    def delete_account(body: DeleteAccount, request: Request,
                       credentials: HTTPAuthorizationCredentials | None = Depends(bearer), accounts=Depends(auth)):
        if not credentials:
            raise invalid()
        # A revoked, unexpired token may ONLY retry this password-confirmed endpoint
        # while deletion is pending. All other endpoints reject it immediately.
        identity, _ = accounts.resolve(credentials.credentials, allow_deleting=True)
        accounts.throttle('reauth', client(request), str(identity))
        with service.locks[identity]:
            return accounts.request_deletion(identity, body.password)

    @app.post('/auth/signup', status_code=202)
    def signup(body: Credentials, request: Request, background: BackgroundTasks, accounts=Depends(auth)):
        return accounts.request_code('signup', body.phone_number, client(request), password=body.password, dispatch=background.add_task)

    @app.post('/auth/verify')
    def verify(body: Code, request: Request, accounts=Depends(auth)):
        return accounts.verify(body.challenge_id, body.code, client(request), 'signup')

    @app.post('/auth/enrollment', status_code=202)
    def enrollment(body: Enrollment, request: Request, background: BackgroundTasks, accounts=Depends(auth)):
        return accounts.request_code('enrollment', body.phone_number, client(request), password=body.password,
                                     enrollment_token=body.enrollment_token, dispatch=background.add_task)

    @app.post('/auth/enrollment/verify')
    def enrollment_verify(body: Code, request: Request, accounts=Depends(auth)):
        return accounts.verify(body.challenge_id, body.code, client(request), 'enrollment')

    @app.post('/auth/resend', status_code=202)
    def resend(body: Resend, request: Request, background: BackgroundTasks, accounts=Depends(auth)):
        return accounts.resend(body.challenge_id, client(request), dispatch=background.add_task)

    @app.post('/auth/login')
    def login(body: Credentials, request: Request, accounts=Depends(auth)):
        return accounts.login(body.phone_number, body.password, client(request))

    @app.post('/auth/refresh')
    def refresh(body: Refresh, request: Request, accounts=Depends(auth)):
        return accounts.refresh(body.refresh_token, client(request))

    @app.post('/auth/logout', status_code=204)
    def logout(account=Depends(registered), accounts=Depends(auth)):
        accounts.logout(*account)

    @app.post('/auth/logout-all', status_code=204)
    def logout_all(account=Depends(registered), accounts=Depends(auth)):
        accounts.logout(*account, all_sessions=True)

    @app.get('/account')
    def current(account=Depends(registered), accounts=Depends(auth)):
        with service.sessions() as db:
            return accounts.account(db.get(User, account[0]))

    @app.post('/auth/recovery', status_code=202)
    def recovery(body: Phone, request: Request, background: BackgroundTasks, accounts=Depends(auth)):
        return accounts.request_code('recovery', body.phone_number, client(request), dispatch=background.add_task)

    @app.post('/auth/reset')
    def reset(body: RecoveryReset, request: Request, accounts=Depends(auth)):
        return accounts.verify(body.challenge_id, body.code, client(request), 'recovery', new_password=body.new_password)

    @app.post('/account/phone', status_code=202)
    def phone(body: Credentials, request: Request, background: BackgroundTasks, account=Depends(registered), accounts=Depends(auth)):
        accounts.throttle('reauth', client(request), str(account[0]))
        return accounts.request_code('phone', body.phone_number, client(request), password=body.password, user_id=account[0], dispatch=background.add_task)

    @app.post('/account/phone/verify')
    def phone_verify(body: Code, request: Request, account=Depends(registered), accounts=Depends(auth)):
        # Shares the delivery admission lock so the recipient is derived atomically at send start.
        with service.locks[account[0]]:
            return accounts.verify(body.challenge_id, body.code, client(request), 'phone', user_id=account[0])

    @app.post('/lessons', status_code=202)
    def submit(body: LessonRequest, background: BackgroundTasks, account=Depends(registered),
               idempotency_key: str | None = Header(default=None, min_length=1, max_length=128, pattern=r'^[A-Za-z0-9._:-]+$')):
        try:
            job_id, created = service.submit(account[0], body.topic, body.voiceover, idempotency_key, admission=True)
        except AdmissionLimited as error:
            raise HTTPException(429, str(error), headers={'Retry-After': str(error.retry_after)}) from None
        except Conflict as error:
            raise HTTPException(409, str(error)) from None
        if created:
            background.add_task(service.process, account[0], job_id)
        return service.status(account[0], job_id)

    @app.get('/lessons/{job_id}')
    def status(job_id: uuid.UUID, account=Depends(registered)):
        result = service.status(account[0], job_id)
        if result is None:
            raise HTTPException(404, 'Lesson not found')
        return result

    @app.post('/lessons/{job_id}/cancel', status_code=202)
    def cancel(job_id: uuid.UUID, account=Depends(registered)):
        try:
            result = service.cancel(account[0], job_id)
        except Conflict as error:
            raise HTTPException(409, str(error)) from None
        if result is None:
            raise HTTPException(404, 'Lesson not found')
        return result

    @app.post('/internal/receipts', status_code=204)
    async def receipt(request: Request):
        secret = request.app.state.receipt_secret
        timestamp = request.headers.get('x-receipt-timestamp', '')
        signature = request.headers.get('x-receipt-signature', '')
        if (not secret or len(timestamp) > 12 or not timestamp.isascii() or not timestamp.isdigit()
                or len(signature) != 64 or not signature.isascii() or abs(time.time() - int(timestamp)) > 300):
            raise HTTPException(401, 'Invalid callback authentication')
        # Bounded streaming body, including chunked callbacks.
        raw = bytearray()
        async for chunk in request.stream():
            raw.extend(chunk)
            if len(raw) > 4096:
                raise HTTPException(413, 'Callback too large')
        expected = hmac.new(secret.encode(), timestamp.encode() + b'.' + raw, hashlib.sha256).hexdigest()
        if not hmac.compare_digest(signature, expected):
            raise HTTPException(401, 'Invalid callback authentication')
        try:
            event = Receipt.model_validate_json(raw)
            if event.read_at.tzinfo is None or event.read_at > datetime.now(timezone.utc) + timedelta(minutes=5):
                raise ValueError()
        except Exception:
            raise HTTPException(400, 'Invalid receipt event') from None
        try:
            await asyncio.to_thread(service.receipt, event.event_id, event.message_id, event.recipient, event.read_at)
        except Conflict as error:
            raise HTTPException(409, str(error)) from None

    return app


app = create_app()
