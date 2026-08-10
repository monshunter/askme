#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" != "--confirm" || "${2:-}" != "askme-local" ]]; then
  echo "Refusing to remove Askme local volumes. Re-run with: scripts/docker-reset.sh --confirm askme-local" >&2
  exit 2
fi

docker compose down --volumes --remove-orphans
