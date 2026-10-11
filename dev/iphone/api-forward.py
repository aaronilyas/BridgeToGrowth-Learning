#!/usr/bin/env python3
"""Temporary LAN API forwarder. No body/header/query logging or stored responses."""
import argparse
import http.client
import ipaddress
import json
import re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

PUBLIC = re.compile(r'^/(auth/(signup|verify|login|refresh|logout|logout-all|recovery|reset|resend|enrollment|enrollment/verify)/?|account(/phone(/verify)?)?/?|lessons/?|lessons/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}(/cancel)?/?)$')
HOP = {'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'host', 'content-length', 'forwarded', 'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto'}


class Handler(BaseHTTPRequestHandler):
    # HTTP/1.0 closes each response; bounded bodies avoid indefinite resources.
    def log_message(self, *_):
        pass

    def handle_one_request(self):
        self.connection.settimeout(15)
        super().handle_one_request()

    def reply(self, status, body=b''):
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def forward(self):
        peer = ipaddress.ip_address(self.client_address[0])
        if peer not in self.server.trusted:
            return self.reply(403)
        # Reject absolute-form requests, path encodings, queries and fragments.
        url = urlsplit(self.path)
        if url.scheme or url.netloc or url.query or url.fragment or '%' in url.path:
            return self.reply(404)
        if self.path == '/__btg_readiness' and self.command == 'GET':
            return self.reply(200, b'{"forwarder":"btg","ready":true}')
        if not PUBLIC.fullmatch(url.path) or self.command not in ('GET', 'POST'):
            return self.reply(404)
        if self.headers.get('Transfer-Encoding'):
            return self.reply(400)
        lengths = self.headers.get_all('Content-Length', [])
        try:
            length = int(lengths[0]) if lengths else 0
        except ValueError:
            return self.reply(400)
        if len(lengths) > 1 or length < 0 or length > 65536:
            return self.reply(413)
        body = self.rfile.read(length)
        if len(body) != length:
            return self.reply(400)
        conn = http.client.HTTPConnection('127.0.0.1', self.server.upstream_port, timeout=30)
        try:
            headers = {k: v for k, v in self.headers.items() if k.lower() not in HOP}
            conn.request(self.command, url.path, body=body, headers=headers)
            response = conn.getresponse()
            data = response.read(2 * 1024 * 1024 + 1)
            if len(data) > 2 * 1024 * 1024:
                return self.reply(502)
            self.send_response(response.status)
            for key, value in response.getheaders():
                if key.lower() not in HOP | {'server', 'date'}:
                    self.send_header(key, value)
            self.send_header('Content-Length', str(len(data)))
            self.send_header('Connection', 'close')
            self.end_headers()
            self.wfile.write(data)
            # Only a public path and status; never auth headers, bodies or queries.
            print(json.dumps({'peer': str(peer), 'method': self.command, 'path': url.path, 'status': response.status}), flush=True)
        except (OSError, http.client.HTTPException):
            self.reply(502)
        finally:
            conn.close()

    do_GET = do_POST = do_PUT = do_DELETE = do_PATCH = do_OPTIONS = do_HEAD = forward


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--bind', required=True)
    parser.add_argument('--trusted-cidr', required=True)
    parser.add_argument('--port', type=int, default=8765)
    parser.add_argument('--upstream-port', type=int, default=8000)
    args = parser.parse_args()
    address = ipaddress.ip_address(args.bind)
    network = ipaddress.ip_network(args.trusted_cidr)
    if not address.is_private or address.is_loopback or address not in network or network.prefixlen < 24:
        parser.error('Use a private LAN address and a trusted IPv4 subnet of /24 or narrower.')
    server = ThreadingHTTPServer((args.bind, args.port), Handler)
    server.daemon_threads = True
    server.trusted, server.upstream_port = network, args.upstream_port
    print(f'API forwarder listening on {args.bind}:{args.port}; trusted {network}; upstream loopback only', flush=True)
    server.serve_forever()
