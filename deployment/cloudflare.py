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
            pages = info.get('total_pages')
            if pages is None and 'total_count' in info:
                size = info.get('per_page', 100)
                if not isinstance(size, int) or size < 1:
                    raise DeploymentError('Cloudflare pagination page size is invalid; activation stopped.')
                pages = max(1, (info['total_count'] + size - 1) // size)
            if pages is None:
                if info and payload['result']:
                    raise DeploymentError('Cloudflare pagination completeness is unverified; operator review required.')
                pages = 1
            if page >= pages:
                return rows
            page += 1
        raise DeploymentError('Cloudflare result pagination exceeded the safety bound.')

    def hostname_pattern(self, pattern):
        # Inspect the whole authority, regardless of path: /lessons*, /auth*,
        # query-specific Page Rules and scheme-less Worker routes also matter.
        authority = pattern.lower().split('://', 1)[-1].split('/', 1)[0]
        if not authority or any(c in authority for c in '?[]@:'):
            raise DeploymentError('Ambiguous Cloudflare URL pattern; operator review required before activation.')
        return fnmatch.fnmatchcase(self.hostname, authority)

    def excludes_hostname(self, expression):
        # A deliberately tiny proof, not a general Rules language interpreter.
        # Compound, regex and unknown expressions remain operator blockers.
        value = expression or ''
        if value.startswith('(') and value.endswith(')'):
            value = value[1:-1]
        simple = re.fullmatch(r'http\.host (eq|ne) "([a-zA-Z0-9.-]+)"', value)
        if simple:
            operator, hostname = simple.groups()
            return hostname != self.hostname if operator == 'eq' else hostname == self.hostname
        return expression == f'not (http.host eq "{self.hostname}")'

    def inspect_override_rulesets(self, rows, scope, phases):
        for row in rows:
            if row.get('phase') not in phases:
                continue
            if not row.get('id'):
                raise DeploymentError('Cloudflare cache/routing/response/snippet ruleset identity unavailable; operator review required.')
            details = self.api('GET', scope + '/rulesets/' + row['id'], permission='Rulesets: Read')
            if not isinstance(details.get('rules'), list):
                raise DeploymentError('Cloudflare ruleset contents unavailable; operator review required.')
            if any(rule.get('enabled', True) and not self.excludes_hostname(rule.get('expression'))
                   for rule in details['rules']):
                raise DeploymentError('Cloudflare cache/routing/response/snippet ruleset may affect the API hostname. '
                                      'Operator: explicitly exclude this hostname; only simple http.host eq/ne exclusions '
                                      'can be verified automatically. Unrelated rules are never modified.')

    def cache_safety(self, read_only=False):
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
                if self.hostname_pattern(pattern):
                    raise DeploymentError('An existing Page Rule matches the API hostname. Exclude this hostname or remove that rule after operator review; public activation stopped.')
        routes = self.listing(self.zone + '/workers/routes', 'Workers Routes: Read (zone)')
        domains = self.listing(self.account + '/workers/domains', 'Workers Scripts: Read (account)')
        if any(self.hostname_pattern(row['pattern']) for row in routes) or any(
                row.get('hostname', '').lower() == self.hostname for row in domains):
            raise DeploymentError('A Worker route matches the API hostname; exclude it before public activation (Workers can override caching/routing).')
        account_sets = self.listing(self.account + '/rulesets', 'Account Rulesets: Read (account)')
        dangerous = {'http_request_cache_settings', 'http_response_cache_settings', 'http_response_headers_transform', 'http_request_snippets',
                     'http_request_transform', 'http_request_late_transform',
                     'http_request_origin', 'http_request_redirect', 'http_request_dynamic_redirect'}
        self.inspect_override_rulesets(account_sets, self.account, dangerous)
        zone_sets = self.listing(self.zone + '/rulesets', 'Rulesets: Read (zone)')
        self.inspect_override_rulesets(zone_sets, self.zone, dangerous - {'http_request_cache_settings'})
        entry = self.api('GET', self.zone + '/rulesets/phases/http_request_cache_settings/entrypoint',
                         permission='Cache Rules: Read (zone)', missing=True)
        owned = []
        expected = dict(ref=self.marker, description=self.marker, expression=f'(http.host eq "{self.hostname}")',
                        action='set_cache_settings', action_parameters={'cache': False}, enabled=True)
        if entry:
            for row in entry.get('rules', []):
                if row.get('ref') == self.marker and not read_only:
                    owned.append(row)
                elif row.get('enabled', True) and not self.excludes_hostname(row.get('expression')) and (row.get('action') != 'set_cache_settings' or row.get('action_parameters') != {'cache': False}):
                    raise DeploymentError('An existing Cache Rule may override API caching. Exclude/review it before activation; unrelated rules are never overwritten.')
        if len(owned) > 1:
            raise DeploymentError('Duplicate owned cache rules; restore/review deployment state.')
        if read_only:
            bypass = [row for row in (entry or {}).get('rules', []) if row.get('enabled', True)
                      and row.get('expression') == expected['expression']
                      and row.get('action') == 'set_cache_settings'
                      and row.get('action_parameters') == {'cache': False}]
            if not bypass:
                raise DeploymentError('Create a Cache Rule: expression ' + expected['expression']
                                      + ', action set_cache_settings, parameters {cache: false}, enabled. '
                                      'External mode is read-only; public readiness failed.')
            return
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
        if self.hostname != zone['name'] and not self.hostname.endswith('.' + zone['name']):
            raise DeploymentError('Hostname must belong to the configured Cloudflare DNS zone (apex is supported).')
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

    def inspect_external(self):
        """Read-only prerequisites. Never adopt, reconfigure or fetch connector tokens."""
        zone = self.api('GET', self.zone, permission='Zone: Read (zone)')
        if (zone.get('account', {}).get('id') != self.values['CLOUDFLARE_ACCOUNT_ID']
                or zone.get('status') != 'active'
                or not (self.hostname == zone['name'] or self.hostname.endswith('.' + zone['name']))):
            raise DeploymentError('Existing hostname/zone/account mismatch; review the root .env identifiers.')
        identity = str(uuid.UUID(self.values['CLOUDFLARE_TUNNEL_ID']))
        tunnel = self.api('GET', self.account + '/cfd_tunnel/' + identity,
                          permission='Cloudflare Tunnel: Read (account)')
        if tunnel.get('deleted_at') or tunnel.get('id') != identity:
            raise DeploymentError('Existing tunnel is missing or deleted; restore the configured existing route.')
        if tunnel.get('config_src') != 'cloudflare':
            raise DeploymentError('Existing connector uses local ingress configuration: automatic public verification is unavailable. '
                                  'Keep port 8000 stopped, validate the loaded host config against deploy/cloudflare/config.example.yml '
                                  '(allowlist and final 404), and stage with --local-only. No connector changes were made.')
        saved = self.api('GET', self.account + '/cfd_tunnel/' + identity + '/configurations',
                         permission='Cloudflare Tunnel: Read (account)')
        ingress = (saved or {}).get('config', {}).get('ingress', [])
        expected = [dict(hostname=self.hostname, path=PUBLIC_PATH, service='http://127.0.0.1:8000'),
                    dict(service='http_status:404')]
        # Exact two-rule topology is deliberately conservative; no inferred regex equivalence.
        actual = [{k: row[k] for k in ('hostname', 'path', 'service') if k in row} for row in ingress]
        if actual != expected or any(row.get('originRequest') for row in ingress):
            raise DeploymentError('Existing tunnel ingress is unverified. Operator: preserve tunnel/DNS/connector credentials; '
                                  'set this hostname route to the exact PUBLIC_PATH in deployment/cloudflare.py, '
                                  'service http://127.0.0.1:8000, then final http_status:404. '
                                  'Do not expose port 8000 until prerequisites pass.')
        if (saved or {}).get('config', {}).get('warp-routing', {}).get('enabled'):
            raise DeploymentError('Existing tunnel private-network routing requires operator review; no origin opened.')
        if (saved or {}).get('config', {}).get('originRequest'):
            raise DeploymentError('Global tunnel origin overrides require operator review; no origin opened.')
        clients = self.api('GET', self.account + '/cfd_tunnel/' + identity + '/connections',
                           permission='Cloudflare Tunnel: Read (account)')
        version = (saved or {}).get('version')
        live = [client for client in clients if client.get('conns')]
        if (not isinstance(version, int) or not live
                or any(client.get('config_version') != version for client in live)):
            raise DeploymentError('External connector ingress convergence is unverified: all connected replicas must report '
                                  'the current tunnel configuration version. Wait for the existing connector to sync; '
                                  'inspect its logs with its owner. No connector started or stopped.')
        records = self.listing(self.zone + '/dns_records?' + urlencode(dict(name=self.hostname)), 'DNS: Read (zone)')
        if (len(records) != 1 or records[0].get('type') != 'CNAME'
                or records[0].get('content') != identity + '.cfargotunnel.com'
                or records[0].get('proxied') is not True):
            raise DeploymentError('Existing DNS does not confirm the configured proxied tunnel target; operator review required. No DNS changes made.')
        self.cache_safety(read_only=True)
        return identity

    def connected(self):
        tunnel_id = (self.values['CLOUDFLARE_TUNNEL_ID'] if self.values.get('CLOUDFLARE_TUNNEL_MODE') == 'external'
                     else self.state.data['cloudflare']['tunnel_id'])
        tunnel = self.api('GET', self.account + '/cfd_tunnel/' + tunnel_id, permission='Cloudflare Tunnel: Read (account)')
        return tunnel.get('status') == 'healthy'
