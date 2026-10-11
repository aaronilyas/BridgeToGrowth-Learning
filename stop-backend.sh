#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env}"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required to stop the backend." >&2
  exit 1
fi
if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE. Set ENV_FILE to the configuration used to start the backend." >&2
  exit 1
fi

COMPOSE=(docker compose --project-directory "$ROOT_DIR" --env-file "$ENV_FILE" -f "$ROOT_DIR/compose.yaml")
echo "Stopping FastAPI and waiting for active jobs to finish. This may take time."
# An unlimited grace period avoids force-killing active jobs. Keep dependencies
# running until the coordinator has drained and stopped successfully.
"${COMPOSE[@]}" stop --timeout -1 coordinator
"${COMPOSE[@]}" stop --timeout -1 messaging postgres
echo "Backend stopped. Database, receipt metadata and user containers are preserved."
