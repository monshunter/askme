#!/usr/bin/env bash
set -euo pipefail

if [[ -f "${HOME}/.env" ]]; then
  docker compose --env-file "${HOME}/.env" up --build "$@"
else
  docker compose up --build "$@"
fi
