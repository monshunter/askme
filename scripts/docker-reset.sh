#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" != "--confirm" || "${2:-}" != "askme-local" ]]; then
  echo "Refusing to remove Askme local volumes. Re-run with: scripts/docker-reset.sh --confirm askme-local" >&2
  exit 2
fi

ASKME_POSTGRES_VOLUME=askme_local_pgdata \
ASKME_UPLOAD_VOLUME=askme_local_uploads \
docker compose -p askme-local down --volumes --remove-orphans
