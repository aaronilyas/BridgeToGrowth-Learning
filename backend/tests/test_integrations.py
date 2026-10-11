"""Reject malformed results at real HTTP adapter boundaries without network access."""
import io
import json
import unittest
from unittest.mock import patch
from urllib.error import HTTPError, URLError

from backend.integrations import Integrations, gemini


class IntegrationTests(unittest.TestCase):
    def test_gemini_daily_quota_is_not_retried_and_body_remains_private(self):
        body = json.dumps({'error': {'details': [{'@type': 'type.googleapis.com/google.rpc.QuotaFailure',
            'violations': [{'quotaId': 'GenerateRequestsPerDayPerProjectPerModel-FreeTier'}]}]}}).encode()
        error = HTTPError('https://example.test', 429, 'quota', {}, io.BytesIO(body))
        with patch.dict('os.environ', {'GEMINI_MODEL': 'test', 'GEMINI_API_KEY': 'test'}), \
                patch('backend.integrations.request_json', side_effect=error) as request, \
                patch('backend.integrations.time.sleep') as sleep:
            with self.assertRaises(HTTPError) as outcome:
                gemini('prompt')
            self.assertEqual(request.call_count, 1)
            sleep.assert_not_called()
            self.assertEqual(outcome.exception.read(), body)

    def test_gemini_accepts_only_unambiguous_single_json_object(self):
        for value in ({'ok': True}, [{'ok': True}], [], [{'ok': True}, {'ok': False}], 'invalid'):
            response = {'candidates': [{'content': {'parts': [{'text': json.dumps(value)}]}}]}
            with self.subTest(value=value), \
                    patch.dict('os.environ', {'GEMINI_MODEL': 'test', 'GEMINI_API_KEY': 'test'}), \
                    patch('backend.integrations.request_json', return_value=response):
                if value in ({'ok': True}, [{'ok': True}]):
                    self.assertEqual(gemini('prompt'), {'ok': True})
                else:
                    with self.assertRaises(ValueError):
                        gemini('prompt')

    def test_gemini_respects_short_provider_retry_delay(self):
        body = json.dumps({'error': {'details': [{'@type': 'type.googleapis.com/google.rpc.RetryInfo',
                                                'retryDelay': '5s'}]}}).encode()
        error = HTTPError('https://example.test', 429, 'busy', {}, io.BytesIO(body))
        response = {'candidates': [{'content': {'parts': [{'text': '{"ok":true}'}]}}]}
        with patch.dict('os.environ', {'GEMINI_MODEL': 'test', 'GEMINI_API_KEY': 'test'}), \
                patch('backend.integrations.request_json', side_effect=[error, response]), \
                patch('backend.integrations.time.sleep') as sleep:
            self.assertEqual(gemini('prompt'), {'ok': True})
            sleep.assert_called_once_with(5)

    def test_gemini_retries_transient_errors_with_bounded_backoff(self):
        response = {'candidates': [{'content': {'parts': [{'text': '{"ok":true}'}]}}]}
        errors = [HTTPError('https://example.test', 503, 'unavailable', {}, io.BytesIO()),
                  HTTPError('https://example.test', 429, 'busy', {}, io.BytesIO())]
        with patch.dict('os.environ', {'GEMINI_MODEL': 'test', 'GEMINI_API_KEY': 'test'}), \
                patch('backend.integrations.request_json', side_effect=[*errors, response]) as request, \
                patch('backend.integrations.time.sleep') as sleep:
            self.assertEqual(gemini('prompt', b'actual video'), {'ok': True})
            self.assertEqual(request.call_count, 3)
            self.assertEqual([call.args[0] for call in sleep.call_args_list], [1, 2])
            self.assertEqual(request.call_args_list[0], request.call_args_list[-1])

    def test_gemini_does_not_retry_permanent_errors_or_exceed_limit(self):
        for status, count in ((400, 1), (403, 1), (503, 3)):
            with self.subTest(status=status), \
                    patch.dict('os.environ', {'GEMINI_MODEL': 'test', 'GEMINI_API_KEY': 'test'}), \
                    patch('backend.integrations.request_json', side_effect=lambda *a: (_ for _ in ()).throw(
                        HTTPError('https://example.test', status, 'failed', {}, io.BytesIO()))) as request, \
                    patch('backend.integrations.time.sleep'):
                with self.assertRaises(HTTPError):
                    gemini('prompt')
                self.assertEqual(request.call_count, count)

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
                self.assertEqual(gemini.call_args.kwargs, {'purpose': 'video'})
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


class GeminiFallbackTests(unittest.TestCase):
    def setUp(self):
        environment = patch.dict('os.environ', {'GEMINI_API_KEY': 'private-test-key',
                                                'GEMINI_MODEL': 'scope-model'}, clear=True)
        environment.start()
        self.addCleanup(environment.stop)
        self.response = {'candidates': [{'content': {'parts': [{'text': '{"ok":true}'}]}}]}

    def error(self, status, body=b'private provider response'):
        return HTTPError('https://example.test', status, 'failed', {}, io.BytesIO(body))

    def models(self, request):
        return [call.args[0].split('/models/')[1].split(':')[0] for call in request.call_args_list]

    def test_primary_and_both_fallbacks_preserve_stage_reasoning_and_input(self):
        for purpose, thinking, video in (('code', 'medium', None), ('video', 'high', b'actual video')):
            with self.subTest(purpose=purpose), \
                    patch('backend.integrations.request_json', side_effect=[self.error(503), self.error(429), self.response]) as request, \
                    patch('backend.integrations.time.sleep') as sleep:
                self.assertEqual(gemini('original intent', video, purpose=purpose), {'ok': True})
                self.assertEqual(self.models(request), ['gemini-3.8-flash', 'gemini-3.5-flash', 'gemini-3.1-flash-lite'])
                for call in request.call_args_list:
                    self.assertEqual(call.args[1]['generationConfig'], {'responseMimeType': 'application/json',
                        'thinkingConfig': {'thinkingLevel': thinking}})
                    self.assertEqual(call.args[1]['contents'], request.call_args_list[0].args[1]['contents'])
                parts = request.call_args.args[1]['contents'][0]['parts']
                self.assertEqual(parts[0], {'text': 'original intent'})
                if video:
                    self.assertEqual(parts[1]['inlineData']['mimeType'], 'video/mp4')
                    self.assertEqual(parts[1]['inlineData']['data'], 'YWN0dWFsIHZpZGVv')
                sleep.assert_not_called()

    def test_successful_primary_stops_without_using_fallbacks(self):
        with patch('backend.integrations.request_json', return_value=self.response) as request:
            gemini('prompt', purpose='code')
            self.assertEqual(self.models(request), ['gemini-3.8-flash'])

    def test_model_availability_quota_transient_and_connection_failures_fall_back(self):
        errors = [self.error(status) for status in (404, 429, 500, 502, 503, 504)]
        errors += [URLError('private connection details'), TimeoutError(), ConnectionError()]
        daily_quota = json.dumps({'error': {'details': [
            {'@type': 'type.googleapis.com/google.rpc.QuotaFailure',
             'violations': [{'quotaId': 'GenerateRequestsPerDayPerProjectPerModel-FreeTier'}]},
            {'@type': 'type.googleapis.com/google.rpc.RetryInfo', 'retryDelay': '38785s'}]}}).encode()
        errors.append(self.error(429, daily_quota))
        for error in errors:
            with self.subTest(error=type(error).__name__, status=getattr(error, 'code', None)), \
                    patch('backend.integrations.request_json', side_effect=[error, self.response]) as request, \
                    patch('backend.integrations.time.sleep') as sleep, \
                    self.assertLogs('backend.integrations', level='WARNING') as logs:
                self.assertEqual(gemini('prompt', purpose='code'), {'ok': True})
                self.assertEqual(self.models(request), ['gemini-3.8-flash', 'gemini-3.5-flash'])
                sleep.assert_not_called()
                self.assertNotIn('private', ''.join(logs.output))

    def test_exhausted_chain_preserves_final_error_body(self):
        final = self.error(503)
        with patch('backend.integrations.request_json', side_effect=[self.error(503), self.error(503), final]) as request:
            with self.assertRaises(HTTPError) as outcome:
                gemini('prompt', purpose='video')
            self.assertEqual(request.call_count, 3)
            self.assertIs(outcome.exception, final)
            self.assertEqual(outcome.exception.read(), b'private provider response')

    def test_permanent_request_errors_do_not_fall_back(self):
        for status in (400, 401, 403):
            with self.subTest(status=status), patch('backend.integrations.request_json', side_effect=self.error(status)) as request:
                with self.assertRaises(HTTPError):
                    gemini('prompt', purpose='code')
                self.assertEqual(request.call_count, 1)

    def test_blocked_or_malformed_results_do_not_fall_back(self):
        responses = [{'promptFeedback': {'blockReason': 'SAFETY'}},
                     {'candidates': [{'content': {'parts': [{'text': 'invalid json'}]}}]}]
        for response in responses:
            with self.subTest(response=response), patch('backend.integrations.request_json', return_value=response) as request:
                with self.assertRaises(ValueError):
                    gemini('prompt', purpose='video')
                self.assertEqual(request.call_count, 1)

    def test_rejected_video_does_not_try_another_evaluator(self):
        result = dict(accurate=False, defect_free=True, consistent=True, findings='incorrect explanation')
        self.response['candidates'][0]['content']['parts'][0]['text'] = json.dumps(result)
        with patch('backend.integrations.request_json', return_value=self.response) as request:
            self.assertFalse(Integrations().evaluate('intent', b'actual video')['approved'])
            self.assertEqual(request.call_count, 1)
            self.assertEqual(request.call_args.args[1]['generationConfig']['thinkingConfig']['thinkingLevel'], 'high')

    def test_scope_assessment_keeps_existing_model_without_stage_reasoning(self):
        with patch('backend.integrations.request_json', return_value=self.response) as request:
            gemini('scope prompt')
            self.assertEqual(self.models(request), ['scope-model'])
            self.assertEqual(request.call_args.args[1]['generationConfig'], {'responseMimeType': 'application/json'})

    def test_stage_overrides_are_independent_and_keep_reasoning(self):
        with patch.dict('os.environ', {'GEMINI_CODE_MODELS': 'custom-code, custom-backup', 'GEMINI_VIDEO_MODELS': 'custom-video'}), \
                patch('backend.integrations.request_json', side_effect=[self.error(404), self.response, self.response]) as request:
            gemini('code', purpose='code')
            gemini('review', b'video', purpose='video')
            self.assertEqual(self.models(request), ['custom-code', 'custom-backup', 'custom-video'])
            self.assertEqual([call.args[1]['generationConfig']['thinkingConfig']['thinkingLevel']
                              for call in request.call_args_list], ['medium', 'medium', 'high'])

    def test_thought_parts_are_excluded_from_json_parsing(self):
        self.response['candidates'][0]['content']['parts'].insert(0, {'thought': True, 'text': 'private reasoning'})
        with patch('backend.integrations.request_json', return_value=self.response):
            self.assertEqual(gemini('prompt', purpose='code'), {'ok': True})
