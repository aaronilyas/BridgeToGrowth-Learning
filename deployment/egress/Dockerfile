FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends squid iptables util-linux ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY deployment/egress/squid.conf /etc/squid/squid.conf
COPY deployment/egress/start.sh /usr/local/bin/btg-egress
ENTRYPOINT ["/usr/local/bin/btg-egress"]
