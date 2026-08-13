#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ -z "${ASKME_CODE_AGENT_IMAGE_DIGEST:-}" && -r "${project_root}/data/code-agent-image/index.json" ]]; then
  image_digest="$(node -e 'const fs=require("node:fs"); const root=process.argv[1]; const index=JSON.parse(fs.readFileSync(`${root}/index.json`,"utf8")); const digest=index.manifests?.[0]?.digest; if(!/^sha256:[0-9a-f]{64}$/.test(digest??"")) process.exit(1); process.stdout.write(digest)' "${project_root}/data/code-agent-image")"
  export ASKME_CODE_AGENT_IMAGE_DIGEST="${image_digest}"
fi

if [[ -f "${HOME}/.env" ]]; then
  docker compose --env-file "${HOME}/.env" up --build "$@"
else
  docker compose up --build "$@"
fi
