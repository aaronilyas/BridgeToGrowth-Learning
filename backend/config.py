"""Fail closed on production settings; test apps inject their own boundaries."""
import os
import re
from urllib.parse import urlsplit


def validate_settings():
    required = ('DATABASE_URL', 'AUTH_CODE_SECRET', 'RECEIPT_SECRET', 'GEMINI_API_KEY', 'GEMINI_MODEL',
                'MESSAGING_URL', 'MESSAGING_TOKEN', 'RENDERER_EGRESS_IMAGE')
    missing = [key for key in required if not os.environ.get(key)]
    if missing:
        raise RuntimeError('Missing required settings: ' + ', '.join(missing))
    for key in ('AUTH_CODE_SECRET', 'RECEIPT_SECRET', 'MESSAGING_TOKEN'):
        if len(os.environ[key]) < 32:
            raise RuntimeError(key + ' must contain at least 32 characters')
    if len({os.environ[k] for k in ('AUTH_CODE_SECRET', 'RECEIPT_SECRET', 'MESSAGING_TOKEN')}) != 3:
        raise RuntimeError('Account, receipt and messaging secrets must be distinct')
    if not os.environ['DATABASE_URL'].startswith('postgresql+psycopg://'):
        raise RuntimeError('DATABASE_URL must use PostgreSQL with psycopg')
    if not re.fullmatch(r'[a-zA-Z0-9._-]+', os.environ['GEMINI_MODEL']):
        raise RuntimeError('Invalid GEMINI_MODEL')
    for key in ('LESSON_REQUEST_LIMIT', 'LESSON_REQUEST_WINDOW_SECONDS', 'LESSON_ACCOUNT_JOB_LIMIT', 'LESSON_GLOBAL_JOB_LIMIT'):
        value = os.environ.get(key, '1')
        if not value.isdigit() or int(value) < 1:
            raise RuntimeError(key + ' must be a positive integer')
    url = urlsplit(os.environ['MESSAGING_URL'])
    if url.scheme not in ('http', 'https') or not url.hostname or url.username or url.query or url.fragment or url.path != '/video':
        raise RuntimeError('MESSAGING_URL must be the trusted service /video URL')
