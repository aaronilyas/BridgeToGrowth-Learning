"""Literal dotenv configuration for the stdlib-only deployment operator."""
import re
from pathlib import Path


class DeploymentError(RuntimeError):
    pass


DEFAULTS = dict(API_PORT='8000', GEMINI_MODEL='gemini-2.5-flash', USER_CONTAINER_IMAGE='btg-renderer:local',
                RENDERER_EGRESS_IMAGE='btg-egress:local', DOCKER_SOCKET_PATH='/var/run/docker.sock',
                CLOUDFLARE_ENABLED='true', CLOUDFLARE_TUNNEL_MODE='external',
                CLOUDFLARE_HOSTNAME='bridgetogrowth-learning.com', LOCAL_API_PORT='18000',
                CLOUDFLARE_TUNNEL_NAME='btg-learning-api',
                LESSON_REQUEST_LIMIT='10', LESSON_REQUEST_WINDOW_SECONDS='86400',
                LESSON_ACCOUNT_JOB_LIMIT='2', LESSON_GLOBAL_JOB_LIMIT='8')
SECRETS = ('AUTH_CODE_SECRET', 'RECEIPT_SECRET', 'MESSAGING_TOKEN')


def load_env(path):
    if not path.is_file():
        raise DeploymentError('Missing root .env. Copy .env.example to .env and fill the required values.')
    result = dict(DEFAULTS)
    seen = set()
    for number, line in enumerate(path.read_text().splitlines(), 1):
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        match = re.fullmatch(r'([A-Z][A-Z0-9_]*)\s*=\s*(.*)', line)
        if not match:
            raise DeploymentError(f'Invalid .env syntax at line {number}; use KEY=value.')
        key, value = match.groups()
        if key in seen:
            raise DeploymentError(f'Duplicate .env setting: {key}')
        seen.add(key)
        if value.startswith(('"', "'")):
            quote = value[0]
            end = value.find(quote, 1)
            if end < 0 or (value[end + 1:].strip() and not value[end + 1:].strip().startswith('#')):
                raise DeploymentError(f'Invalid literal quote at .env line {number}')
            value = value[1:end]
        else:
            value = re.split(r'\s+#', value, maxsplit=1)[0].strip()
        # Deliberately a documented subset of dotenv, with no executable/interpolated values.
        if any(c in value for c in ('$','`','\\','\x00')):
            raise DeploymentError(f'{key}: interpolation and escape syntax are unsupported; use literal values.')
        if key.startswith('EXPO_PUBLIC_') and key != 'EXPO_PUBLIC_API_BASE_URL':
            raise DeploymentError('Only the public API origin may use an EXPO_PUBLIC_ variable.')
        result[key] = value
    return result


def validate(values, local_only=False):
    required = ('POSTGRES_PASSWORD', *SECRETS, 'GEMINI_API_KEY', 'GEMINI_MODEL', 'PROJECT_ID', 'PROJECT_SECRET')
    missing = [key for key in required if not values.get(key)]
    if missing:
        raise DeploymentError('Missing required settings: ' + ', '.join(missing))
    for key in SECRETS:
        value = values[key]
        if len(value) < 32 or len(set(value)) < 10 or any(word in value.lower() for word in ('replace-with', 'changeme', 'your-secret')):
            raise DeploymentError(f'{key} must be an independently generated random secret (openssl rand -hex 32).')
    if len({values[key] for key in (*SECRETS, 'POSTGRES_PASSWORD')}) != 4:
        raise DeploymentError('AUTH_CODE_SECRET, RECEIPT_SECRET, MESSAGING_TOKEN and POSTGRES_PASSWORD must be distinct.')
    if len(values['POSTGRES_PASSWORD']) < 20 or len(set(values['POSTGRES_PASSWORD'])) < 10 or not re.fullmatch(r'[A-Za-z0-9_-]+', values['POSTGRES_PASSWORD']):
        raise DeploymentError('POSTGRES_PASSWORD must be at least 20 URL-safe characters; generate with openssl rand -hex 32.')
    if not re.fullmatch(r'[a-zA-Z0-9._-]+', values['GEMINI_MODEL']):
        raise DeploymentError('Invalid GEMINI_MODEL.')
    for key in ('API_PORT', 'LOCAL_API_PORT', 'LESSON_REQUEST_LIMIT', 'LESSON_REQUEST_WINDOW_SECONDS', 'LESSON_ACCOUNT_JOB_LIMIT', 'LESSON_GLOBAL_JOB_LIMIT'):
        if not values[key].isdigit() or int(values[key]) < 1 or (key in ('API_PORT', 'LOCAL_API_PORT') and int(values[key]) > 65535):
            raise DeploymentError(f'{key} must be a positive integer' + (' <= 65535.' if key in ('API_PORT', 'LOCAL_API_PORT') else '.'))
    for key in ('USER_CONTAINER_IMAGE', 'RENDERER_EGRESS_IMAGE'):
        if not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9./:_-]*', values[key]):
            raise DeploymentError(f'Invalid {key} image tag.')
    if not values['DOCKER_SOCKET_PATH'].startswith('/'):
        raise DeploymentError('DOCKER_SOCKET_PATH must be an absolute daemon-side path.')
    if values['CLOUDFLARE_ENABLED'] not in ('true', 'false'):
        raise DeploymentError('CLOUDFLARE_ENABLED must be true or false.')
    if values['CLOUDFLARE_TUNNEL_MODE'] not in ('external', 'managed'):
        raise DeploymentError('CLOUDFLARE_TUNNEL_MODE must be external or managed.')
    if values['API_PORT'] != '8000':
        raise DeploymentError('API_PORT must be 8000 for the existing public origin; use LOCAL_API_PORT for private staging.')
    if int(values['LOCAL_API_PORT']) == 8000:
        raise DeploymentError('LOCAL_API_PORT must differ from 8000: the existing connector forwards to port 8000.')
    enabled = not local_only and values['CLOUDFLARE_ENABLED'] == 'true'
    if enabled:
        for key in ('CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_ZONE_ID'):
            if not re.fullmatch(r'[a-fA-F0-9]{32}', values.get(key, '')):
                raise DeploymentError(f'{key} must be the 32-character Cloudflare identifier.')
        if not re.fullmatch(r'[A-Za-z0-9_-]{20,}', values.get('CLOUDFLARE_API_TOKEN', '')):
            raise DeploymentError('Public prerequisites unavailable: set a scoped read-only CLOUDFLARE_API_TOKEN for external mode (see cloudflare.md); no backend will start on port 8000.')
        if values['CLOUDFLARE_TUNNEL_MODE'] == 'external':
            import uuid
            try:
                uuid.UUID(values.get('CLOUDFLARE_TUNNEL_ID', ''))
            except ValueError:
                raise DeploymentError('External mode requires the existing CLOUDFLARE_TUNNEL_ID; do not create a new tunnel.') from None
        if values['CLOUDFLARE_TUNNEL_MODE'] == 'managed' and not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}', values['CLOUDFLARE_TUNNEL_NAME']):
            raise DeploymentError('Invalid CLOUDFLARE_TUNNEL_NAME.')
        hostname = values.get('CLOUDFLARE_HOSTNAME', '')
        if (hostname != hostname.lower() or len(hostname) > 253 or '.' not in hostname
                or any(not re.fullmatch(r'[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?', part) for part in hostname.split('.'))
                or hostname in ('api.example.com', 'example.com')):
            raise DeploymentError('CLOUDFLARE_HOSTNAME must be your lowercase DNS hostname, without scheme, port or path.')
    return enabled
