"""Reject malformed results at real HTTP adapter boundaries without network access."""
import io
import json
import unittest
from unittest.mock import patch

from backend.integrations import Integrations


class IntegrationTests(unittest.TestCase):
    def test_scope_rejects_invalid_estimates(self):
        for seconds in (-1, True, 90.5, '90', None):
            with self.subTest(seconds=seconds), patch('backend.integrations.gemini', return_value={'seconds': seconds, 'feedback': 'split'}):
                with self.assertRaises(ValueError):
                    Integrations().assess('intent')

    def test_evaluator_requires_all_three_checks_and_actual_video(self):
        for failed in ('accurate', 'defect_free', 'consistent'):
            result = dict(accurate=True, defect_free=True, consistent=True, findings='issue')
            result[failed] = False
            with patch('backend.integrations.gemini', return_value=result) as gemini:
                self.assertFalse(Integrations().evaluate('original intent', b'actual video')['approved'])
                self.assertEqual(gemini.call_args.args[1], b'actual video')
                self.assertIn('original intent', gemini.call_args.args[0])
        with patch('backend.integrations.gemini', return_value={'accurate': 'true'}):
            with self.assertRaises(ValueError):
                Integrations().evaluate('intent', b'video')

    def test_delivery_requires_explicit_acceptance_and_id(self):
        with patch.dict('os.environ', {'MESSAGING_URL': 'https://node.example/video', 'MESSAGING_TOKEN': 'test-only'}):
            for result in ({'accepted': False}, {'accepted': True}, {'accepted': 'true', 'message_id': 'id'}):
                with self.subTest(result=result), patch('backend.integrations.urlopen', return_value=io.BytesIO(json.dumps(result).encode())):
                    with self.assertRaises(ValueError):
                        Integrations().deliver('job', '+15550000001', b'video')
            with patch('backend.integrations.urlopen', return_value=io.BytesIO(b'{"accepted": true, "message_id": "id"}')) as send:
                self.assertEqual(Integrations().deliver('job', '+15550000001', b'video'), 'id')
                request = send.call_args.args[0]
                self.assertEqual(request.data, b'video')
                self.assertEqual(request.get_header('X-recipient'), '+15550000001')
                self.assertEqual(request.get_header('X-lesson-job'), 'job')

    def test_requested_narration_requires_separate_quality_checks(self):
        result = dict(accurate=True, defect_free=True, consistent=True, findings='',
                      narration_accurate=True, narration_intelligible=True, narration_consistent=True)
        with patch('backend.integrations.gemini', return_value=result) as evaluator:
            self.assertTrue(Integrations().evaluate('intent', b'actual audio video', voiceover=True)['approved'])
            self.assertIn('intelligibility', evaluator.call_args.args[0])
        for key in ('narration_accurate', 'narration_intelligible', 'narration_consistent'):
            bad = {**result, key: False}
            with patch('backend.integrations.gemini', return_value=bad):
                self.assertFalse(Integrations().evaluate('intent', b'video', voiceover=True)['approved'])
            bad.pop(key)
            with patch('backend.integrations.gemini', return_value=bad):
                with self.assertRaises(ValueError):
                    Integrations().evaluate('intent', b'video', voiceover=True)
