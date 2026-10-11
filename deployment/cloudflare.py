"""Remotely managed Tunnel + DNS + cache bypass, with fail-closed ownership.

Only documented HTTPS APIs; no cloudflared host login and no temporary tunnels.
Transport is injectable so tests never touch a Cloudflare account.
"""
import fnmatch
import json
import re
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen
import uuid

from .settings import DeploymentError

PUBLIC_PATH = (r'^/(auth/(signup|verify|login|refresh|logout|logout-all|recovery|reset|resend|enrollment|enrollment/verify)/?'
               r'|account(/phone(/verify)?|/delete)?/?|lessons/?'
               r'|lessons/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}(/cancel)?/?)$')


class Cloudflare:
    def __init__(self, values, state, transport=None):
        self.values, self.state = values, state
        self.transport = transport or self.request
        self.account = '/accounts/' + values['CLOUDFLARE_ACCOUNT_ID']
        self.zone = '/zones/' + values['CLOUDFLARE_ZONE_ID']
        self.hostname = values['CLOUDFLARE_HOSTNAME']
        self.marker = 'btg-' + state.data['deployment_id']

    def request(self, method, path, body, permission, allow_missing=False):
        request = Request('https://api.cloudflare.com/client/v4' + path, method=method,
                          data=json.dumps(body).encode() if body is not None else None,
                          headers={'Authorization': 'Bearer ' + self.values['CLOUDFLARE_API_TOKEN'],
                                   'Content-Type': 'application/json'})
        try:
            with urlopen(request, timeout=30) as response:
                payload = json.load(response)
        except HTTPError as error:
            if error.code == 404 and allow_missing:
                return None
            if error.code in (401, 403):
                raise DeploymentError(f'Cloudflare denied {method} {path.split("?")[0]}. Required: {permission}; check token expiry and account/zone scope.') from None
            raise DeploymentError(f'Cloudflare {method} {path.split("?")[0]} failed (HTTP {error.code}); check service status, DNS configuration and plan limits. Retry startup; no automatic POST retry.') from None
        except (URLError, TimeoutError, ValueError, OSError):
            raise DeploymentError('Cloudflare API connection/response failed; check network and retry startup. If a creation response was lost, restore ownership IDs before continuing.') from None
        if not payload.get('success'):
            # Do not echo provider bodies: they may contain credentials.
            raise DeploymentError(f'Cloudflare rejected {method} {path.split("?")[0]}; required: {permission}. Check resource scope and plan limits.')
        return payload

    def api(self, method, path, body=None, permission='Cloudflare Tunnel: Edit (account)', missing=False):
        payload = self.transport(method, path, body, permission, missing)
        return None if payload is None else payload['result']

    def listing(self, path, permission):
        rows, page = [], 1
        while page <= 100:
            separator = '&' if '?' in path else '?'
            payload = self.transport('GET', f'{path}{separator}page={page}&per_page=100', None, permission, False)
            rows.extend(payload['result'])
            info = payload.get('result_info', {})
            if page >= info.get('total_pages', 1):
                return rows
            page += 1
        raise DeploymentError('Cloudflare result pagination exceeded the safety bound.')

    def cache_safety(self):
        """Inspect all zone cache rules and reject ambiguous overrides/Workers.

        Do not update a whole ruleset: only append our owned hostname bypass rule.
        Account phase rulesets and response/snippet rules require operator review.
        """
        settings = self.api('GET', self.zone + '/settings', permission='Zone Settings: Read (zone)')
        if any(row['id'] == 'origin_max_http_version' and not row.get('value') for row in settings):
            raise DeploymentError('Invalid zone origin settings.')
        pages = self.listing(self.zone + '/pagerules?status=active', 'Page Rules: Read (zone)')
        for row in pages:
            for target in row.get('targets', []):
                pattern = target.get('constraint', {}).get('value', '')
                if fnmatch.fnmatchcase('https://' + self.hostname + '/account', pattern) or fnmatch.fnmatchcase('http://' + self.hostname + '/account', pattern):
                    raise DeploymentError('An existing Page Rule matches the API hostname. Exclude this hostname or remove that rule after operator review; public activation stopped.')
        routes = self.api('GET', self.zone + '/workers/routes', permission='Workers Routes: Read (zone)')
        if any(fnmatch.fnmatchcase('https://' + self.hostname + '/account', row['pattern'])
               or fnmatch.fnmatchcase(self.hostname + '/account', row['pattern']) for row in routes):
            raise DeploymentError('A Worker route matches the API hostname; exclude it before public activation (Workers can override caching/routing).')
        account_sets = self.api('GET', self.account + '/rulesets', permission='Account Rulesets: Read (account)')
        dangerous = {'http_request_cache_settings', 'http_response_cache_settings', 'http_response_headers_transform', 'http_request_snippets'}
        if any(row.get('phase') in dangerous for row in account_sets):
            raise DeploymentError('Account cache/response/snippet rulesets need operator review. Use an account without these overrides for automatic activation.')
        zone_sets = self.api('GET', self.zone + '/rulesets', permission='Cache Rules: Read (zone)')
        if any(row.get('phase') in dangerous - {'http_request_cache_settings'} for row in zone_sets):
            raise DeploymentError('Zone cache-response/header/snippet rulesets cannot be safely evaluated; exclude API overrides before public activation.')
        entry = self.api('GET', self.zone + '/rulesets/phases/http_request_cache_settings/entrypoint',
                         permission='Cache Rules: Read (zone)', missing=True)
        owned = []
        expected = dict(ref=self.marker, description=self.marker, expression=f'(http.host eq "{self.hostname}")',
                        action='set_cache_settings', action_parameters={'cache': False}, enabled=True)
        if entry:
            for row in entry.get('rules', []):
                if row.get('ref') == self.marker:
                    owned.append(row)
                elif row.get('enabled', True) and row.get('action_parameters', {}).get('cache') is not False:
                    raise DeploymentError('An existing Cache Rule may override API caching. Exclude/review it before activation; unrelated rules are never overwritten.')
        if len(owned) > 1:
            raise DeploymentError('Duplicate owned cache rules; restore/review deployment state.')
        metadata = self.state.data.setdefault('cloudflare', {})
        if owned:
            row = owned[0]
            if (metadata.get('cache_ruleset_id') != entry['id'] or metadata.get('cache_rule_id') != row['id']
                    or any(row.get(key) != value for key, value in expected.items())):
                raise DeploymentError('Cache rule ownership/configuration mismatch. Restore state or review remotely; no adoption.')
        else:
            if metadata.get('cache_rule_id'):
                raise DeploymentError('Previously owned cache rule disappeared; operator review required.')
            if entry:
                updated = self.api('POST', self.zone + '/rulesets/' + entry['id'] + '/rules', expected,
                                   permission='Cache Rules: Edit (zone)')
            else:
                updated = self.api('POST', self.zone + '/rulesets', dict(name=self.marker, kind='zone',
                                   phase='http_request_cache_settings', rules=[expected]), permission='Cache Rules: Edit (zone)')
            row = next((r for r in updated.get('rules', []) if r.get('ref') == self.marker), None)
            if not row:
                raise DeploymentError('Cloudflare did not confirm the cache bypass rule; activation stopped.')
            metadata.update(cache_ruleset_id=updated['id'], cache_rule_id=row['id'])
            self.state.save()

    def provision(self):
        verified = self.api('GET', '/user/tokens/verify', permission='an active user API token')
        if verified.get('status') != 'active':
            raise DeploymentError('Cloudflare API token is not active; replace the expired/revoked token in root .env.')
        zone = self.api('GET', self.zone, permission='Zone: Read (selected zone)')
        if zone.get('account', {}).get('id') != self.values['CLOUDFLARE_ACCOUNT_ID'] or zone.get('status') != 'active':
            raise DeploymentError('Cloudflare zone must be active and belong to the configured account.')
        if not self.hostname.endswith('.' + zone['name']):
            raise DeploymentError('Use a subdomain of the configured Cloudflare DNS zone.')
        metadata = self.state.data.setdefault('cloudflare', {})
        identity = dict(account_id=self.values['CLOUDFLARE_ACCOUNT_ID'], zone_id=self.values['CLOUDFLARE_ZONE_ID'],
                        hostname=self.hostname, tunnel_name=self.values['CLOUDFLARE_TUNNEL_NAME'])
        if metadata and any(key in metadata and metadata[key] != value for key, value in identity.items()):
            raise DeploymentError('Cloudflare configuration changed deployment identity; restore the saved configuration or explicitly migrate ownership state.')
        metadata.update(identity)
        self.state.save()
        tunnels = self.listing(self.account + '/cfd_tunnel?' + urlencode(dict(name=identity['tunnel_name'], is_deleted='false')),
                               'Cloudflare Tunnel: Edit (account, includes read)')
        matches = [t for t in tunnels if t['name'] == identity['tunnel_name']]
        records = self.listing(self.zone + '/dns_records?' + urlencode(dict(name=self.hostname)), 'DNS: Edit (zone, includes read)')
        tunnel_id = metadata.get('tunnel_id')
        if tunnel_id:
            tunnel = self.api('GET', self.account + '/cfd_tunnel/' + tunnel_id)
            if (tunnel.get('id') != tunnel_id or tunnel.get('name') != identity['tunnel_name']
                    or tunnel.get('config_src') != 'cloudflare' or tunnel.get('deleted_at')
                    or any(t['id'] != tunnel_id for t in matches)):
                raise DeploymentError('Saved tunnel ownership/configuration mismatch; no unrelated tunnel will be adopted.')
        else:
            if matches or records:
                raise DeploymentError('Pre-existing tunnel name or DNS hostname has no saved ownership IDs. Choose unused names or restore .local/backend/state.json; no adoption.')
        if records:
            expected = tunnel_id + '.cfargotunnel.com' if tunnel_id else ''
            if len(records) != 1 or records[0]['id'] != metadata.get('dns_id') or records[0]['type'] != 'CNAME' or records[0]['content'] != expected or records[0].get('proxied') is not True or records[0].get('comment') != self.marker:
                raise DeploymentError('DNS conflict or ownership mismatch. Restore owned state or choose an unused hostname; existing DNS is never overwritten.')
        elif metadata.get('dns_id'):
            raise DeploymentError('Previously owned DNS record disappeared; operator review required.')
        # Assess cache policies and install bypass BEFORE creating DNS/starting a connector.
        self.cache_safety()
        if not tunnel_id:
            tunnel = self.api('POST', self.account + '/cfd_tunnel', dict(name=identity['tunnel_name'], config_src='cloudflare'))
            tunnel_id = str(uuid.UUID(tunnel['id']))
            metadata['tunnel_id'] = tunnel_id
            self.state.save()  # Store the returned identity before the next mutation.
        config = dict(ingress=[dict(hostname=self.hostname, path=PUBLIC_PATH, service='http://coordinator:8000', originRequest={}),
                               dict(service='http_status:404')])
        saved = self.api('GET', self.account + '/cfd_tunnel/' + tunnel_id + '/configurations')
        if saved and saved.get('config', {}).get('ingress') and saved.get('config') != config and metadata.get('configured'):
            raise DeploymentError('Remote tunnel configuration changed outside this deployment; review before activation.')
        if not saved or saved.get('config') != config:
            self.api('PUT', self.account + '/cfd_tunnel/' + tunnel_id + '/configurations', {'config': config})
        metadata['configured'] = True
        self.state.save()
        if not records:
            record = self.api('POST', self.zone + '/dns_records', dict(type='CNAME', proxied=True, name=self.hostname,
                              content=tunnel_id + '.cfargotunnel.com', ttl=1, comment=self.marker), permission='DNS: Edit (zone)')
            metadata['dns_id'] = record['id']
            self.state.save()
        token = self.api('GET', self.account + '/cfd_tunnel/' + tunnel_id + '/token')
        if not isinstance(token, str) or not re.fullmatch(r'[A-Za-z0-9_+/=-]+', token):
            raise DeploymentError('Cloudflare returned an invalid connector token; public activation stopped.')
        self.state.write('connector-token', token + '\n')
        return tunnel_id

    def connected(self):
        tunnel_id = self.state.data['cloudflare']['tunnel_id']
        tunnel = self.api('GET', self.account + '/cfd_tunnel/' + tunnel_id)
        return tunnel.get('status') == 'healthy'
