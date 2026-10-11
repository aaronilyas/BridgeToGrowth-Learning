"""Backend-owned accounts, Argon2id credentials and opaque PostgreSQL sessions."""
from datetime import datetime, timedelta, timezone
import hashlib
import hmac
import logging
import secrets
import threading
import uuid

from argon2 import PasswordHasher, Type
from argon2.exceptions import VerificationError, InvalidHashError
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from .models import AuthRate, AuthSession, AuthToken, User, UserContainer, Verification

log = logging.getLogger(__name__)
PASSWORDS = PasswordHasher(type=Type.ID)
DUMMY_HASH = PASSWORDS.hash(secrets.token_urlsafe(32))
ACCESS_SECONDS = 900
REFRESH_SECONDS = 30 * 86400
CODE_SECONDS = 600


def utc(value):
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def invalid():
    return HTTPException(401, 'Invalid or expired credentials', headers={'WWW-Authenticate': 'Bearer'})


def password_matches(encoded, password):
    try:
        return PASSWORDS.verify(encoded or DUMMY_HASH, password) and encoded is not None
    except (VerificationError, InvalidHashError):
        return False


class Accounts:
    def __init__(self, sessions, transport, code_secret, clock=None):
        if len(code_secret) < 32:
            raise ValueError('AUTH_CODE_SECRET must contain at least 32 characters')
        self.sessions, self.transport, self.secret = sessions, transport, code_secret.encode()
        self.clock = clock or (lambda: datetime.now(timezone.utc))
        # One coordinator; serializes security mutations and persists every limit.
        self.lock = threading.RLock()

    def keyed(self, value):
        return hmac.new(self.secret, value.encode(), hashlib.sha256).hexdigest()

    def throttle(self, operation, client, subject=''):
        with self.lock, self.sessions() as db:
            limited = False
            for source, limit in ((f'ip:{client}', 30), (f'subject:{subject}', 10)):
                key = self.keyed(f'{operation}:{source}')
                row = db.get(AuthRate, key)
                if row is None:
                    row = AuthRate(key=key, window_start=self.clock(), count=0)
                    db.add(row)
                elif self.clock() - utc(row.window_start) >= timedelta(minutes=15):
                    row.window_start, row.count = self.clock(), 0
                row.count += 1
                limited |= row.count > limit
            db.commit()
            if limited:
                raise HTTPException(429, 'Too many attempts; try again later', headers={'Retry-After': '900'})

    def account(self, user):
        return {'id': str(user.id), 'phone_number': user.phone_number,
                'phone_verified': user.phone_verified_at is not None}

    def tokens(self, db, session):
        access, refresh = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
        db.add_all([AuthToken(token_hash=digest(access), session_id=session.id, kind='access',
                              expires_at=self.clock() + timedelta(seconds=ACCESS_SECONDS)),
                    AuthToken(token_hash=digest(refresh), session_id=session.id, kind='refresh',
                              expires_at=session.expires_at)])
        return {'token_type': 'Bearer', 'access_token': access, 'refresh_token': refresh,
                'expires_in': ACCESS_SECONDS, 'refresh_expires_in': max(0, int((utc(session.expires_at) - self.clock()).total_seconds()))}

    def new_session(self, db, user):
        db.flush()
        session = AuthSession(id=uuid.uuid4(), user_id=user.id,
                              expires_at=self.clock() + timedelta(seconds=REFRESH_SECONDS))
        db.add(session)
        db.flush()
        result = self.tokens(db, session)
        result['account'] = self.account(user)
        return result

    def resolve(self, token):
        if len(token) > 128:
            raise invalid()
        with self.lock, self.sessions() as db:
            row = db.get(AuthToken, digest(token))
            session = db.get(AuthSession, row.session_id) if row else None
            user = db.get(User, session.user_id) if session else None
            if (not row or row.kind != 'access' or utc(row.expires_at) <= self.clock()
                    or not session or session.revoked_at or utc(session.expires_at) <= self.clock()
                    or not user or not user.password_hash or not user.phone_verified_at):
                raise invalid()
            return user.id, session.id

    def login(self, phone, password, client):
        self.throttle('login', client, phone)
        with self.lock, self.sessions() as db:
            user = db.scalar(select(User).where(User.phone_number == phone))
            valid = password_matches(user.password_hash if user else None, password)
            if not valid or not user.phone_verified_at:
                raise invalid()
            if PASSWORDS.check_needs_rehash(user.password_hash):
                user.password_hash = PASSWORDS.hash(password)
            result = self.new_session(db, user)
            db.commit()
            return result

    def refresh(self, token, client):
        self.throttle('refresh', client, digest(token))
        with self.lock, self.sessions() as db:
            row = db.get(AuthToken, digest(token))
            session = db.get(AuthSession, row.session_id) if row else None
            if not row or row.kind != 'refresh' or not session:
                raise invalid()
            if row.used_at:
                # Retain consumed hashes for the full family lifetime to detect reuse.
                session.revoked_at = self.clock()
                db.commit()
                raise invalid()
            if session.revoked_at or utc(session.expires_at) <= self.clock() or utc(row.expires_at) <= self.clock():
                raise invalid()
            row.used_at = self.clock()
            # Rotating invalidates old access tokens from this session as well.
            for access in db.scalars(select(AuthToken).where(AuthToken.session_id == session.id, AuthToken.kind == 'access')):
                access.expires_at = self.clock()
            result = self.tokens(db, session)
            db.commit()
            return result

    def revoke(self, db, user_id, session_id=None):
        query = select(AuthSession).where(AuthSession.user_id == user_id, AuthSession.revoked_at.is_(None))
        if session_id:
            query = query.where(AuthSession.id == session_id)
        for session in db.scalars(query):
            session.revoked_at = self.clock()

    def logout(self, user_id, session_id, all_sessions=False):
        with self.lock, self.sessions() as db:
            self.revoke(db, user_id, None if all_sessions else session_id)
            db.commit()

    def request_code(self, purpose, phone, client, password=None, user_id=None, enrollment_token=None, dispatch=None):
        self.throttle('code-request', client, phone)
        with self.lock, self.sessions() as db:
            user = db.get(User, user_id) if user_id else db.scalar(select(User).where(User.phone_number == phone))
            encoded = PASSWORDS.hash(password) if purpose in ('signup', 'enrollment') else None
            eligible = purpose == 'signup' and user is None
            if purpose == 'enrollment':
                eligible = bool(user and not user.password_hash and user.enrollment_hash
                                and user.enrollment_expires_at and utc(user.enrollment_expires_at) > self.clock()
                                and hmac.compare_digest(user.enrollment_hash, digest(enrollment_token or '')))
            if purpose == 'recovery':
                eligible = bool(user and user.password_hash and user.phone_verified_at)
            if purpose == 'phone':
                if not user or not password_matches(user.password_hash, password):
                    raise invalid()
                occupied = db.scalar(select(User.id).where(User.phone_number == phone))
                eligible = occupied is None and phone != user.phone_number
            previous = db.scalar(select(Verification).where(Verification.phone_number == phone).order_by(Verification.sent_at.desc()).limit(1))
            # Same response for occupied, unknown, cooling down, and valid recipients.
            if previous and self.clock() - utc(previous.sent_at) < timedelta(seconds=60):
                eligible = False
            identifier = uuid.uuid4()
            code = f'{secrets.randbelow(1000000):06d}'
            challenge = Verification(id=identifier, user_id=user.id if user else None,
                phone_number=phone, purpose=purpose, code_hash=self.keyed(f'{identifier}:{code}'),
                password_hash=encoded, credential_snapshot=user.password_hash if user else None,
                expires_at=self.clock() + timedelta(seconds=CODE_SECONDS), sent_at=self.clock(), eligible=eligible)
            db.add(challenge)
            db.commit()
        if eligible:
            if dispatch:
                dispatch(self.send_code, phone, code, identifier)
            else:
                self.send_code(phone, code, identifier)
        return {'challenge_id': str(identifier), 'expires_in': CODE_SECONDS,
                'resend_after': 60, 'message': 'If eligible, a verification message will be sent'}

    def send_code(self, phone, code, identifier):
        try:
            self.transport.verification(phone, code)
        except Exception:
            # No exception text: urllib/provider errors can contain credentials.
            log.warning('Verification transport failed for challenge %s', identifier)
            # Keep the challenge eligible for a bounded resend; a failed transport
            # is not verification evidence and the code hash remains single-use.

    def resend(self, identifier, client, dispatch=None):
        self.throttle('resend', client, str(identifier))
        with self.lock, self.sessions() as db:
            row = db.get(Verification, identifier)
            if (not row or row.consumed_at or row.attempts >= 5 or utc(row.expires_at) <= self.clock()
                    or self.clock() - utc(row.sent_at) < timedelta(seconds=60)):
                return {'message': 'If eligible, a verification message will be sent', 'resend_after': 60}
            # Recipient-wide cooldown also applies across challenge IDs.
            other = db.scalar(select(Verification).where(Verification.phone_number == row.phone_number,
                Verification.id != row.id).order_by(Verification.sent_at.desc()).limit(1))
            if other and self.clock() - utc(other.sent_at) < timedelta(seconds=60):
                return {'message': 'If eligible, a verification message will be sent', 'resend_after': 60}
            code = f'{secrets.randbelow(1000000):06d}'
            row.code_hash, row.sent_at = self.keyed(f'{identifier}:{code}'), self.clock()
            # Resends never reset attempts or extend the challenge's absolute expiry.
            phone, eligible = row.phone_number, row.eligible
            db.commit()
        if eligible:
            if dispatch:
                dispatch(self.send_code, phone, code, identifier)
            else:
                self.send_code(phone, code, identifier)
        return {'message': 'If eligible, a verification message will be sent', 'resend_after': 60}

    def verify(self, identifier, code, client, purpose, new_password=None, user_id=None):
        self.throttle('verify', client, str(identifier))
        with self.lock, self.sessions() as db:
            row = db.get(Verification, identifier)
            valid = bool(row and not row.consumed_at and row.attempts < 5
                         and utc(row.expires_at) > self.clock() and row.purpose == purpose
                         and (purpose != 'phone' or row.user_id == user_id))
            if row and not row.consumed_at and row.attempts < 5:
                row.attempts += 1
            matches = hmac.compare_digest(self.keyed(f'{identifier}:{code}'), row.code_hash if row else '0' * 64)
            if not valid or not matches or not row.eligible:
                db.commit()
                raise HTTPException(400, 'Invalid or expired verification')
            user = db.get(User, row.user_id) if row.user_id else None
            if user and (row.credential_snapshot != user.password_hash
                         or (purpose in ('recovery', 'enrollment') and row.phone_number != user.phone_number)):
                row.consumed_at = self.clock()
                db.commit()
                raise HTTPException(400, 'Invalid or expired verification')
            row.consumed_at = self.clock()
            if purpose == 'signup':
                user = User(id=uuid.uuid4(), phone_number=row.phone_number, password_hash=row.password_hash,
                            phone_verified_at=self.clock())
                db.add(user)
                db.add(UserContainer(user_id=user.id, last_authenticated_request_at=self.clock()))
            elif purpose in ('enrollment', 'recovery'):
                user.password_hash = row.password_hash if purpose == 'enrollment' else PASSWORDS.hash(new_password)
                user.phone_verified_at = self.clock()
                user.enrollment_hash, user.enrollment_expires_at = None, None
                if not user.container:
                    db.add(UserContainer(user_id=user.id, last_authenticated_request_at=self.clock()))
                self.revoke(db, user.id)
            elif purpose == 'phone':
                user.phone_number, user.phone_verified_at = row.phone_number, self.clock()
                self.revoke(db, user.id)
            try:
                result = self.new_session(db, user) if purpose in ('signup', 'enrollment') else {'message': 'Account updated; log in again'}
                db.commit()
            except IntegrityError:
                db.rollback()
                # Consume losing concurrent signup/phone challenge without disclosing which account exists.
                db.get(Verification, identifier).consumed_at = self.clock()
                db.commit()
                raise HTTPException(400, 'Invalid or expired verification') from None
            return result
