"""Three public operations; external identity provider owns credentials."""
import asyncio
from contextlib import asynccontextmanager
import logging
import re
import uuid

from fastapi import BackgroundTasks, Depends, FastAPI, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from .database import SessionLocal, engine
from .integrations import Integrations
from .runtime import DockerRuntime
from .service import Service


class LessonRequest(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)
    topic: str = Field(min_length=1, max_length=10000)
    voiceover: bool = False


def create_app(service=None, coordinator_guard=True):
    service = service or Service(SessionLocal, Integrations(), DockerRuntime())

    @asynccontextmanager
    async def lifespan(app):
        guard = None
        if coordinator_guard:
            # A single coordinator keeps the admission/shutdown lock atomic without a broker.
            guard = engine.connect()
            if not guard.scalar(text('SELECT pg_try_advisory_lock(78264019)')):
                guard.close()
                raise RuntimeError('Run exactly one API worker/coordinator')
        async def cleanup():
            while True:
                await asyncio.sleep(30)
                try:
                    await asyncio.to_thread(service.sweep)
                except Exception:
                    logging.getLogger(__name__).exception('Inactivity sweep failed')
        task = asyncio.create_task(cleanup())
        try:
            yield
        finally:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
            if guard:
                guard.execute(text('SELECT pg_advisory_unlock(78264019)'))
                guard.close()

    app = FastAPI(lifespan=lifespan)
    app.state.service = service
    bearer = HTTPBearer(auto_error=False)

    def identity(credentials: HTTPAuthorizationCredentials | None = Depends(bearer)):
        if credentials is None:
            raise HTTPException(401, 'Authentication required', headers={'WWW-Authenticate': 'Bearer'})
        try:
            result = service.integrations.authenticate(credentials.credentials)
            if result.get('active') is not True:
                raise ValueError('Inactive session')
            user_id = uuid.UUID(result['user_id'])
            phone = result['phone_number']
            if result.get('phone_verified') is not True or not re.fullmatch(r'\+[1-9][0-9]{7,14}', phone):
                raise ValueError('Verified phone required')
        except Exception:
            raise HTTPException(401, 'Invalid or expired session', headers={'WWW-Authenticate': 'Bearer'}) from None
        return user_id, phone

    def registered(account=Depends(identity)):
        if not service.touch(account[0]):
            raise HTTPException(403, 'Register the account first')
        return account[0]

    @app.put('/account')
    def register(account=Depends(identity)):
        try:
            return service.register(*account)
        except (IntegrityError, ValueError):
            raise HTTPException(409, 'Account or recipient conflicts with registration') from None

    @app.post('/lessons', status_code=202)
    def submit(body: LessonRequest, background: BackgroundTasks, user_id=Depends(registered)):
        job_id = service.submit(user_id, body.topic)
        background.add_task(service.process, user_id, job_id, body.voiceover)
        return {'id': str(job_id), 'status': 'queued'}

    @app.get('/lessons/{job_id}')
    def status(job_id: uuid.UUID, user_id=Depends(registered)):
        result = service.status(user_id, job_id)
        if result is None:
            raise HTTPException(404, 'Lesson not found')
        return result

    return app


app = create_app()
