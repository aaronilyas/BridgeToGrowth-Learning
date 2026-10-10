"""Authentication and account onboarding contracts; no external services or jobs."""
from datetime import datetime, timedelta, timezone
import io
import json
from types import SimpleNamespace
import unittest
import uuid
from unittest.mock import Mock, patch

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.integrations import Integrations
from backend.main import create_app
from backend.models import Base, LessonJob, User, UserContainer
from backend.service import Service


class AuthenticationTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine('sqlite://', connect_args={'check_same_thread': False}, poolclass=StaticPool)
        Base.metadata.create_all(self.engine)
        self.sessions = sessionmaker(self.engine, expire_on_commit=False)
        self.user_id = uuid.uuid4()
        self.claims = {'active': True, 'user_id': str(self.user_id),
                       'phone_number': '+15551234567', 'phone_verified': True}
        self.authenticate = Mock(return_value=self.claims)
        self.runtime = Mock()
        self.now = datetime(2026, 1, 1, tzinfo=timezone.utc)
        self.service = Service(self.sessions, SimpleNamespace(authenticate=self.authenticate),
                               self.runtime, lambda: self.now)
        self.client = TestClient(create_app(self.service, coordinator_guard=False))
        self.headers = {'Authorization': 'Bearer provider-session'}

    def tearDown(self):
        self.client.close()
        self.engine.dispose()

    def assert_no_accounts_or_work(self):
        with self.sessions() as db:
            for model in (User, UserContainer, LessonJob):
                self.assertEqual(db.scalars(select(model)).all(), [])
        self.assertEqual(self.runtime.mock_calls, [])

    def test_missing_or_non_bearer_authorization_never_calls_provider(self):
        for authorization in (None, '', 'Basic secret', 'Bearer'):
            headers = {} if authorization is None else {'Authorization': authorization}
            for method, path, body in (
                ('put', '/account', None), ('post', '/lessons', {'topic': 'Gravity'}),
                ('get', '/lessons/' + str(uuid.uuid4()), None),
            ):
                with self.subTest(authorization=authorization, path=path):
                    response = self.client.request(method, path, headers=headers, json=body)
                    self.assertEqual(response.status_code, 401)
                    self.assertEqual(response.headers['WWW-Authenticate'], 'Bearer')
        self.authenticate.assert_not_called()
        self.assert_no_accounts_or_work()

    def test_malformed_or_unverified_identity_cannot_register(self):
        invalid = [None, [], 'identity', {}, {'active': False}]
        for key, values in (
            ('active', [False, None, 'true', 1]),
            ('user_id', [None, '', 'not-a-uuid', 123]),
            ('phone_verified', [False, None, 'true', 1]),
            ('phone_number', [None, 123, '', '15551234567', '+05551234567',
                              '+1234567', '+1234567890123456', '+1555 1234567',
                              '+15551234567\n']),
        ):
            invalid.extend({**self.claims, key: value} for value in values)
            invalid.append({k: v for k, v in self.claims.items() if k != key})
        for claims in invalid:
            with self.subTest(claims=claims):
                self.authenticate.return_value = claims
                response = self.client.put('/account', headers=self.headers)
                self.assertEqual(response.status_code, 401)
                self.assertEqual(response.json(), {'detail': 'Invalid or expired session'})
                self.assertEqual(response.headers['WWW-Authenticate'], 'Bearer')
                self.assert_no_accounts_or_work()

    def test_provider_failure_is_rejected_without_exposing_details(self):
        self.authenticate.side_effect = RuntimeError('provider secret and session')
        response = self.client.put('/account', headers=self.headers)
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json(), {'detail': 'Invalid or expired session'})
        self.assert_no_accounts_or_work()

    def test_account_uses_provider_identity_and_is_idempotent(self):
        expected = {'id': str(self.user_id), 'phone_number': self.claims['phone_number']}
        for _ in range(2):
            response = self.client.put('/account', headers=self.headers)
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json(), expected)
        self.authenticate.assert_called_with('provider-session')
        with self.sessions() as db:
            self.assertEqual(len(db.scalars(select(User)).all()), 1)
            self.assertEqual(len(db.scalars(select(UserContainer)).all()), 1)
            self.assertEqual(db.scalars(select(LessonJob)).all(), [])
        self.assertEqual(self.runtime.mock_calls, [])

    def test_request_body_cannot_override_provider_identity_or_recipient(self):
        response = self.client.put('/account', headers=self.headers,
                                   json={'user_id': str(uuid.uuid4()), 'phone_number': '+15557654321'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {'id': str(self.user_id), 'phone_number': '+15551234567'})

    def test_conflicting_phone_and_phone_change_preserve_original_account(self):
        self.assertEqual(self.client.put('/account', headers=self.headers).status_code, 200)
        other = uuid.uuid4()
        for claims in ({**self.claims, 'user_id': str(other)},
                       {**self.claims, 'phone_number': '+15557654321'}):
            with self.subTest(claims=claims):
                self.authenticate.return_value = claims
                response = self.client.put('/account', headers=self.headers)
                self.assertEqual(response.status_code, 409)
                self.assertEqual(response.json(), {'detail': 'Account or recipient conflicts with registration'})
        with self.sessions() as db:
            self.assertEqual(db.get(User, self.user_id).phone_number, '+15551234567')
            self.assertIsNone(db.get(User, other))
            self.assertEqual(len(db.scalars(select(UserContainer)).all()), 1)

    def test_authenticated_unregistered_identity_requires_account_onboarding(self):
        for method, path, body in (
            ('post', '/lessons', {'topic': 'Gravity'}),
            ('get', '/lessons/' + str(uuid.uuid4()), None),
        ):
            response = self.client.request(method, path, headers=self.headers, json=body)
            self.assertEqual(response.status_code, 403)
            self.assertEqual(response.json(), {'detail': 'Register the account first'})
        self.assert_no_accounts_or_work()

    def test_revoked_session_does_not_refresh_registered_account(self):
        self.client.put('/account', headers=self.headers)
        self.now += timedelta(minutes=24)
        self.authenticate.return_value = {'active': False}
        for method, path, body in (
            ('put', '/account', None), ('post', '/lessons', {'topic': 'Gravity'}),
            ('get', '/lessons/' + str(uuid.uuid4()), None),
        ):
            response = self.client.request(method, path, headers=self.headers, json=body)
            self.assertEqual(response.status_code, 401)
        with self.sessions() as db:
            container = db.scalar(select(UserContainer).where(UserContainer.user_id == self.user_id))
            self.assertEqual(container.last_authenticated_request_at.replace(tzinfo=timezone.utc),
                             self.now - timedelta(minutes=24))
            self.assertEqual(db.scalars(select(LessonJob)).all(), [])
        self.assertEqual(self.runtime.mock_calls, [])

    def test_registered_authenticated_request_refreshes_activity(self):
        self.client.put('/account', headers=self.headers)
        self.now += timedelta(minutes=24)
        response = self.client.get('/lessons/' + str(uuid.uuid4()), headers=self.headers)
        self.assertEqual(response.status_code, 404)
        with self.sessions() as db:
            container = db.scalar(select(UserContainer).where(UserContainer.user_id == self.user_id))
            self.assertEqual(container.last_authenticated_request_at.replace(tzinfo=timezone.utc), self.now)

    def test_missing_provider_configuration_fails_closed(self):
        self.authenticate.side_effect = Integrations().authenticate
        with patch.dict('os.environ', {}, clear=True), patch('backend.integrations.urlopen') as send:
            response = self.client.put('/account', headers=self.headers)
        self.assertEqual(response.status_code, 401)
        send.assert_not_called()
        self.assert_no_accounts_or_work()

    def test_introspection_forwards_session_using_existing_get_contract(self):
        self.authenticate.side_effect = Integrations().authenticate
        with patch.dict('os.environ', {'AUTH_INTROSPECTION_URL': 'https://identity.example/introspect'}):
            with patch('backend.integrations.urlopen', return_value=io.BytesIO(json.dumps(self.claims).encode())) as send:
                response = self.client.put('/account', headers=self.headers)
        self.assertEqual(response.status_code, 200)
        request = send.call_args.args[0]
        self.assertEqual(request.full_url, 'https://identity.example/introspect')
        self.assertEqual(request.get_method(), 'GET')
        self.assertEqual(request.get_header('Authorization'), 'Bearer provider-session')
        self.assertIsNone(request.data)


if __name__ == '__main__':
    unittest.main()
