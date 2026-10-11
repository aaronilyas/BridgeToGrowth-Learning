#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env}"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required. Install it and start the Docker daemon." >&2
  exit 1
fi
if ! command -v python3 >/dev/null 2>&1; then
  echo "Python 3 is required to read the configured container image tags." >&2
  exit 1
fi
if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE. Copy .env.example to .env and fill its required values." >&2
  exit 1
fi

# Compose parses the environment file; do not execute it as a shell script.
COMPOSE=(docker compose --project-directory "$ROOT_DIR" --env-file "$ENV_FILE" -f "$ROOT_DIR/compose.yaml")
"${COMPOSE[@]}" config --quiet
docker info >/dev/null

# These images are used by isolated user containers on the same Docker daemon.
# Read configured tags from Compose without printing credentials.
EGRESS_IMAGE="$("${COMPOSE[@]}" config --format json | python3 -c 'import json,sys; print(json.load(sys.stdin)["services"]["coordinator"]["environment"]["RENDERER_EGRESS_IMAGE"])')"
RENDERER_IMAGE="$("${COMPOSE[@]}" config --format json | python3 -c 'import json,sys; print(json.load(sys.stdin)["services"]["coordinator"]["environment"]["USER_CONTAINER_IMAGE"])')"
docker build -f deployment/egress/Dockerfile -t "$EGRESS_IMAGE" .
docker build -f backend/container/Dockerfile -t "$RENDERER_IMAGE" .
"${COMPOSE[@]}" up -d --build --wait postgres messaging coordinator
"${COMPOSE[@]}" ps
echo "Backend started. The API is bound to loopback on the configured API_PORT (default 8000)."
