"""Real account API/Argon2id/opaque sessions with deterministic message transport."""
from datetime import datetime, timedelta, timezone
import os
import unittest
import uuid
from unittest.mock import Mock, patch

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.auth import Accounts, digest, password_matches
from backend.main import create_app
from backend.models import Base, User, UserContainer, Verification, AuthToken, AuthRate
from backend.service import Service

PASSWORD = 'a long test password'
NEW_PASSWORD = 'a different test password'
PHONE = '+15551234567'


class AuthenticationTests(unittest.TestCase):
    def setUp(self):
        url = os.environ.get('TEST_DATABASE_URL')
        self.engine = create_engine(url) if url else create_engine('sqlite://', connect_args={'check_same_thread': False}, poolclass=StaticPool)
        Base.metadata.drop_all(self.engine)
        Base.metadata.create_all(self.engine)
        self.sessions = sessionmaker(self.engine, expire_on_commit=False)
        self.now = datetime(2026, 10, 10, tzinfo=timezone.utc)
        self.transport, self.runtime = Mock(), Mock()
        self.accounts = Accounts(self.sessions, self.transport, 'synthetic-code-secret-' * 2, lambda: self.now)
        self.service = Service(self.sessions, self.transport, self.runtime, lambda: self.now)
        self.client = TestClient(create_app(self.service, False, self.accounts))

    def tearDown(self):
        self.client.close()
        self.engine.dispose()

    def request(self, path, data, status=200, headers=None):
        response = self.client.post(path, json=data, headers=headers or {})
        self.assertEqual(response.status_code, status, response.text)
        return response.json() if response.content else None

    def signup(self, phone=PHONE):
        challenge = self.request('/auth/signup', {'phone_number': phone, 'password': PASSWORD}, 202)
        code = self.transport.verification.call_args.args[1]
        result = self.request('/auth/verify', {'challenge_id': challenge['challenge_id'], 'code': code})
        return result, challenge, code

    def headers(self, result):
        return {'Authorization': 'Bearer ' + result['access_token']}

    def test_signup_verification_no_plaintext_and_current_account(self):
        result, challenge, code = self.signup()
        account = self.client.get('/account', headers=self.headers(result)).json()
        self.assertTrue(account['phone_verified'])
        self.assertEqual(account['phone_number'], PHONE)
        with self.sessions() as db:
            user = db.get(User, uuid.UUID(account['id']))
            self.assertTrue(user.password_hash.startswith('$argon2id$'))
            self.assertTrue(password_matches(user.password_hash, PASSWORD))
            verification = db.get(Verification, uuid.UUID(challenge['challenge_id']))
            self.assertNotEqual(verification.code_hash, code)
            self.assertNotIn(code, verification.code_hash)
            self.assertIsNotNone(verification.consumed_at)
            self.assertIsNone(db.get(AuthToken, result['access_token']))
            self.assertIsNotNone(db.get(AuthToken, digest(result['access_token'])))
        self.request('/auth/verify', {'challenge_id': challenge['challenge_id'], 'code': code}, 400)
        self.runtime.assert_not_called()

    def test_unverified_cannot_login_or_create_account(self):
        self.request('/auth/signup', {'phone_number': PHONE, 'password': PASSWORD}, 202)
        self.request('/auth/login', {'phone_number': PHONE, 'password': PASSWORD}, 401)
        with self.sessions() as db:
            self.assertEqual(db.scalars(select(User)).all(), [])
            self.assertEqual(db.scalars(select(UserContainer)).all(), [])

    def test_login_access_expiry_rotation_reuse_and_logout(self):
        result, _, _ = self.signup()
        login = self.request('/auth/login', {'phone_number': PHONE, 'password': PASSWORD})
        self.now += timedelta(seconds=901)
        self.assertEqual(self.client.get('/account', headers=self.headers(login)).status_code, 401)
        renewed = self.request('/auth/refresh', {'refresh_token': login['refresh_token']})
        self.assertEqual(self.client.get('/account', headers=self.headers(renewed)).status_code, 200)
        self.request('/auth/refresh', {'refresh_token': login['refresh_token']}, 401)
        self.assertEqual(self.client.get('/account', headers=self.headers(renewed)).status_code, 401)
        login = self.request('/auth/login', {'phone_number': PHONE, 'password': PASSWORD})
        self.request('/auth/logout', {}, 204, self.headers(login))
        self.assertEqual(self.client.get('/account', headers=self.headers(login)).status_code, 401)
        self.request('/auth/refresh', {'refresh_token': login['refresh_token']}, 401)

    def test_logout_all_and_refresh_absolute_expiry(self):
        first, _, _ = self.signup()
        second = self.request('/auth/login', {'phone_number': PHONE, 'password': PASSWORD})
        self.request('/auth/logout-all', {}, 204, self.headers(first))
        for result in (first, second):
            self.assertEqual(self.client.get('/account', headers=self.headers(result)).status_code, 401)
        third = self.request('/auth/login', {'phone_number': PHONE, 'password': PASSWORD})
        self.now += timedelta(days=30, seconds=1)
        self.request('/auth/refresh', {'refresh_token': third['refresh_token']}, 401)

    def test_recovery_reset_revokes_sessions_and_is_single_use(self):
        session, _, _ = self.signup()
        self.now += timedelta(seconds=61)
        challenge = self.request('/auth/recovery', {'phone_number': PHONE}, 202)
        code = self.transport.verification.call_args.args[1]
        payload = {'challenge_id': challenge['challenge_id'], 'code': code, 'new_password': NEW_PASSWORD}
        self.request('/auth/reset', payload)
        self.request('/auth/reset', payload, 400)
        self.assertEqual(self.client.get('/account', headers=self.headers(session)).status_code, 401)
        self.request('/auth/refresh', {'refresh_token': session['refresh_token']}, 401)
        self.request('/auth/login', {'phone_number': PHONE, 'password': PASSWORD}, 401)
        self.request('/auth/login', {'phone_number': PHONE, 'password': NEW_PASSWORD})

    def test_phone_change_requires_reauth_new_verification_and_revokes_all(self):
        session, _, _ = self.signup()
        new_phone = '+15557654321'
        self.request('/account/phone', {'phone_number': new_phone, 'password': NEW_PASSWORD}, 401, self.headers(session))
        challenge = self.request('/account/phone', {'phone_number': new_phone, 'password': PASSWORD}, 202, self.headers(session))
        code = self.transport.verification.call_args.args[1]
        self.request('/account/phone/verify', {'challenge_id': challenge['challenge_id'], 'code': code}, headers=self.headers(session))
        self.assertEqual(self.client.get('/account', headers=self.headers(session)).status_code, 401)
        self.request('/auth/login', {'phone_number': PHONE, 'password': PASSWORD}, 401)
        result = self.request('/auth/login', {'phone_number': new_phone, 'password': PASSWORD})
        self.assertEqual(result['account']['id'], session['account']['id'])

    def test_throttling_invalid_codes_resend_cooldown_and_expiry(self):
        challenge = self.request('/auth/signup', {'phone_number': PHONE, 'password': PASSWORD}, 202)
        identifier = challenge['challenge_id']
        old = self.transport.verification.call_args.args[1]
        self.request('/auth/resend', {'challenge_id': identifier}, 202)
        self.assertEqual(self.transport.verification.call_count, 1)
        self.now += timedelta(seconds=61)
        with patch('backend.auth.secrets.randbelow', return_value=(int(old) + 1) % 1000000):
            self.request('/auth/resend', {'challenge_id': identifier}, 202)
        new = self.transport.verification.call_args.args[1]
        self.assertNotEqual(old, new)
        for _ in range(5):
            self.request('/auth/verify', {'challenge_id': identifier, 'code': old}, 400)
        self.request('/auth/verify', {'challenge_id': identifier, 'code': new}, 400)
        self.now += timedelta(minutes=16)
        challenge = self.request('/auth/signup', {'phone_number': PHONE, 'password': PASSWORD}, 202)
        code = self.transport.verification.call_args.args[1]
        self.now += timedelta(seconds=600)
        self.request('/auth/verify', {'challenge_id': challenge['challenge_id'], 'code': code}, 400)
        for _ in range(10):
            self.request('/auth/login', {'phone_number': PHONE, 'password': PASSWORD}, 401)
        self.request('/auth/login', {'phone_number': PHONE, 'password': PASSWORD}, 429)
        # Limits survive constructing a new account service.
        replacement = Accounts(self.sessions, self.transport, 'synthetic-code-secret-' * 2, lambda: self.now)
        with self.assertRaises(Exception) as error:
            replacement.login(PHONE, PASSWORD, 'testclient')
        self.assertEqual(error.exception.status_code, 429)

    def test_unauthenticated_responses_do_not_reveal_existence(self):
        session, _, _ = self.signup()
        self.now += timedelta(seconds=61)
        before = self.transport.verification.call_count
        occupied = self.request('/auth/signup', {'phone_number': PHONE, 'password': NEW_PASSWORD}, 202)
        self.assertEqual(before, self.transport.verification.call_count)
        unknown = self.request('/auth/recovery', {'phone_number': '+15550000009'}, 202)
        known = self.request('/auth/recovery', {'phone_number': PHONE}, 202)
        self.assertEqual(set(known), set(unknown))
        self.assertEqual(known['message'], unknown['message'])
        known_error = self.request('/auth/login', {'phone_number': PHONE, 'password': NEW_PASSWORD}, 401)
        unknown_error = self.request('/auth/login', {'phone_number': '+15550000009', 'password': NEW_PASSWORD}, 401)
        self.assertEqual(known_error, unknown_error)

    def test_authentication_activity_and_malformed_secret_redaction(self):
        session, _, _ = self.signup()
        before = self.now
        self.now += timedelta(minutes=16)
        for headers in ({}, self.headers(session), {'Authorization': 'Bearer forged'}):
            self.assertEqual(self.client.get('/account', headers=headers).status_code, 401)
        with self.sessions() as db:
            self.assertEqual(db.scalar(select(UserContainer)).last_authenticated_request_at.replace(tzinfo=timezone.utc), before)
        session = self.request('/auth/login', {'phone_number': PHONE, 'password': PASSWORD})
        self.assertEqual(self.client.get('/lessons/' + str(uuid.uuid4()), headers=self.headers(session)).status_code, 404)
        with self.sessions() as db:
            self.assertEqual(db.scalar(select(UserContainer)).last_authenticated_request_at.replace(tzinfo=timezone.utc), self.now)
        response = self.client.post('/auth/login', json={'phone_number': PHONE, 'password': 'SECRET'})
        self.assertEqual(response.status_code, 422)
        self.assertNotIn('SECRET', response.text)

    def test_legacy_enrollment_preserves_uuid_and_requires_invitation(self):
        identifier = uuid.uuid4()
        token = 'legacy-invitation-' * 3
        with self.sessions() as db:
            db.add(User(id=identifier, phone_number=PHONE, enrollment_hash=digest(token), enrollment_expires_at=self.now + timedelta(hours=24)))
            db.add(UserContainer(user_id=identifier))
            db.commit()
        self.request('/auth/signup', {'phone_number': PHONE, 'password': PASSWORD}, 202)
        self.transport.verification.assert_not_called()
        self.now += timedelta(seconds=61)
        challenge = self.request('/auth/enrollment', {'phone_number': PHONE, 'password': PASSWORD, 'enrollment_token': token}, 202)
        code = self.transport.verification.call_args.args[1]
        result = self.request('/auth/enrollment/verify', {'challenge_id': challenge['challenge_id'], 'code': code})
        self.assertEqual(result['account']['id'], str(identifier))
        with self.sessions() as db:
            user = db.get(User, identifier)
            self.assertIsNone(user.enrollment_hash)
            self.assertTrue(user.phone_verified_at)
            self.assertEqual(len(db.scalars(select(UserContainer)).all()), 1)

    def test_stale_security_challenges_cannot_overwrite_new_password(self):
        session, _, _ = self.signup()
        phone_challenge = self.request('/account/phone', {'phone_number': '+15557654321', 'password': PASSWORD}, 202, self.headers(session))
        phone_code = self.transport.verification.call_args.args[1]
        self.now += timedelta(seconds=61)
        reset = self.request('/auth/recovery', {'phone_number': PHONE}, 202)
        reset_code = self.transport.verification.call_args.args[1]
        self.request('/auth/reset', {'challenge_id': reset['challenge_id'], 'code': reset_code, 'new_password': NEW_PASSWORD})
        new_session = self.request('/auth/login', {'phone_number': PHONE, 'password': NEW_PASSWORD})
        self.request('/account/phone/verify', {'challenge_id': phone_challenge['challenge_id'], 'code': phone_code}, 400, self.headers(new_session))

    def test_legacy_wrong_or_expired_invitation_does_not_send_or_enroll(self):
        identifier = uuid.uuid4()
        token = 'legacy-invitation-' * 3
        with self.sessions() as db:
            db.add(User(id=identifier, phone_number=PHONE, enrollment_hash=digest(token),
                        enrollment_expires_at=self.now + timedelta(seconds=30)))
            db.add(UserContainer(user_id=identifier))
            db.commit()
        for supplied in ('wrong-invitation-' * 3, token):
            challenge = self.request('/auth/enrollment', {'phone_number': PHONE, 'password': PASSWORD, 'enrollment_token': supplied}, 202)
            self.request('/auth/enrollment/verify', {'challenge_id': challenge['challenge_id'], 'code': '000000'}, 400)
            self.now += timedelta(seconds=61)
        self.transport.verification.assert_not_called()
        self.request('/auth/recovery', {'phone_number': PHONE}, 202)
        self.transport.verification.assert_not_called()
        with self.sessions() as db:
            self.assertIsNone(db.get(User, identifier).password_hash)
            self.assertIsNone(db.get(User, identifier).phone_verified_at)

    def test_two_valid_signup_challenges_cannot_create_two_accounts_or_overwrite_password(self):
        first = self.request('/auth/signup', {'phone_number': PHONE, 'password': PASSWORD}, 202)
        code1 = self.transport.verification.call_args.args[1]
        self.now += timedelta(seconds=61)
        second = self.request('/auth/signup', {'phone_number': PHONE, 'password': NEW_PASSWORD}, 202)
        code2 = self.transport.verification.call_args.args[1]
        self.request('/auth/verify', {'challenge_id': first['challenge_id'], 'code': code1})
        self.request('/auth/verify', {'challenge_id': second['challenge_id'], 'code': code2}, 400)
        self.request('/auth/login', {'phone_number': PHONE, 'password': PASSWORD})
        self.request('/auth/login', {'phone_number': PHONE, 'password': NEW_PASSWORD}, 401)
        with self.sessions() as db:
            self.assertEqual(len(db.scalars(select(User)).all()), 1)



if __name__ == '__main__':
    unittest.main()
