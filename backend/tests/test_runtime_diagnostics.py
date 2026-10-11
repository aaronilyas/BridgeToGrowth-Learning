"""Failed worker stderr remains private and bounded; video stdout is never saved."""
import subprocess
import tempfile
from pathlib import Path
import unittest
import uuid
from unittest.mock import patch

from backend.runtime import DockerRuntime


class RuntimeDiagnosticTests(unittest.TestCase):
    def test_generation_forwards_code_policy_only_to_trusted_worker(self):
        for environment, expected in (({}, 'gemini-3.8-flash,gemini-3.5-flash,gemini-3.1-flash-lite'),
                                      ({'GEMINI_CODE_MODELS': 'custom-code, backup'}, 'custom-code,backup')):
            with self.subTest(environment=environment), patch.dict('os.environ', environment, clear=True), \
                    patch.object(DockerRuntime, '_run', return_value=b'{}') as run:
                DockerRuntime().command('btg-user-test', 'generate', uuid.uuid4())
                self.assertIn('GEMINI_API_KEY', run.call_args.args)
                self.assertIn('GEMINI_CODE_MODELS=' + expected, run.call_args.args)
                DockerRuntime().command('btg-user-test', 'render', uuid.uuid4())
                self.assertFalse(any(arg.startswith('GEMINI_') for arg in run.call_args.args))

    def test_failed_generation_records_only_bounded_stderr(self):
        identifier = uuid.uuid4()
        error = subprocess.CalledProcessError(1, ['docker'], output=b'never store video stdout',
                                             stderr=b'x' * 100000 + b'actual worker error')
        factory = tempfile.NamedTemporaryFile
        with tempfile.TemporaryDirectory() as directory:
            def private_file(**kwargs):
                return factory(**{**kwargs, 'dir': directory})
            with patch.object(DockerRuntime, '_run', side_effect=error), \
                    patch('backend.runtime.tempfile.NamedTemporaryFile', side_effect=private_file):
                with self.assertRaises(subprocess.CalledProcessError):
                    DockerRuntime().command('btg-user-' + str(identifier), 'generate', identifier, {})
            files = list(Path(directory).iterdir())
            self.assertEqual(len(files), 1)
            self.assertEqual(len(files[0].read_bytes()), 65536)
            self.assertTrue(files[0].read_bytes().endswith(b'actual worker error'))
            self.assertNotIn(error.output, files[0].read_bytes())
            self.assertEqual(files[0].stat().st_mode & 0o777, 0o600)

    def test_failed_video_action_never_creates_diagnostic_storage(self):
        error = subprocess.CalledProcessError(1, ['docker'], output=b'video', stderr=b'error')
        with patch.object(DockerRuntime, '_run', side_effect=error), \
                patch('backend.runtime.tempfile.NamedTemporaryFile') as diagnostic:
            with self.assertRaises(subprocess.CalledProcessError):
                DockerRuntime().command('btg-user-test', 'video', uuid.uuid4())
            diagnostic.assert_not_called()
