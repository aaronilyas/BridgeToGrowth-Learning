"""Production settings reject missing secrets and malformed endpoints before I/O."""
import unittest
from unittest.mock import patch
from fastapi.testclient import TestClient
from backend.config import validate_settings
from backend.main import create_app

VALID = {'DATABASE_URL': 'postgresql+psycopg://synthetic@postgres/btg',
         'AUTH_CODE_SECRET': 'synthetic-auth-' * 3, 'RECEIPT_SECRET': 'synthetic-receipt-' * 3,
         'MESSAGING_TOKEN': 'synthetic-messaging-' * 3, 'GEMINI_API_KEY': 'synthetic',
         'GEMINI_MODEL': 'synthetic-model', 'MESSAGING_URL': 'http://messaging:3001/video',
         'RENDERER_EGRESS_IMAGE': 'btg-egress:local'}


class ConfigurationTests(unittest.TestCase):
    def test_missing_production_settings_fail_before_database_or_provider_io(self):
        with patch.dict('os.environ', {}, clear=True):
            with self.assertRaisesRegex(RuntimeError, 'Missing required settings'):
                with TestClient(create_app()):
                    pass

    def test_required_settings_validate_secrets_model_database_and_transport(self):
        with patch.dict('os.environ', VALID, clear=True):
            validate_settings()
        for field, value in [('AUTH_CODE_SECRET', 'short'), ('DATABASE_URL', 'sqlite://'),
                             ('GEMINI_MODEL', 'model/../../secret'), ('MESSAGING_URL', 'http://user:password@host/video'),
                             ('MESSAGING_URL', 'http://host/private'), ('RECEIPT_SECRET', VALID['AUTH_CODE_SECRET'])]:
            with self.subTest(field=field), patch.dict('os.environ', {**VALID, field: value}, clear=True):
                with self.assertRaises(RuntimeError):
                    validate_settings()

    def test_stage_chains_reject_empty_unsafe_duplicate_or_unbounded_models(self):
        for setting in ('GEMINI_CODE_MODELS', 'GEMINI_VIDEO_MODELS'):
            for value in ('', 'model,', 'model/../../secret', 'model,model', 'one,two,three,four'):
                with self.subTest(setting=setting, value=value), \
                        patch.dict('os.environ', {**VALID, setting: value}, clear=True):
                    with self.assertRaisesRegex(RuntimeError, setting):
                        validate_settings()
            with patch.dict('os.environ', {**VALID, setting: 'primary, backup'}, clear=True):
                validate_settings()
