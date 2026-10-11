#!/bin/sh
set -eu
# Rules belong to a separate trusted network namespace owner. Generated code
# has UID 1000, no capabilities and cannot modify rules or bypass the proxy.
iptables -A OUTPUT -m owner --uid-owner 1000 -p tcp -d 127.0.0.1 --dport 3128 -j ACCEPT
iptables -A OUTPUT -m owner --uid-owner 1000 -j REJECT
ip6tables -A OUTPUT -m owner --uid-owner 1000 -j REJECT
# Renderer connection responses and proxy traffic use distinct UIDs.
exec setpriv --reuid=13 --regid=13 --clear-groups --bounding-set=-all --no-new-privs squid -N -f /etc/squid/squid.conf
