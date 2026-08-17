#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ -z "${ASKME_CODE_AGENT_IMAGE_DIGEST:-}" && -r "${project_root}/data/code-agent-image/index.json" ]]; then
  image_digest="$(node -e 'const fs=require("node:fs"); const root=process.argv[1]; const index=JSON.parse(fs.readFileSync(`${root}/index.json`,"utf8")); const digest=index.manifests?.[0]?.digest; if(!/^sha256:[0-9a-f]{64}$/.test(digest??"")) process.exit(1); process.stdout.write(digest)' "${project_root}/data/code-agent-image")"
  export ASKME_CODE_AGENT_IMAGE_DIGEST="${image_digest}"
fi

# Layer env files for Compose interpolation (later --env-file wins over earlier):
#   shell env > project .env > ~/.env (machine-level secrets/overrides) > compose defaults.
# The project .env must stay readable so e.g. ASKME_SMTP_* can switch between
# Mailpit (local) and a real production SMTP server without touching ~/.env.
env_files=()
if [[ -f "${HOME}/.env" ]]; then
  env_files+=(--env-file "${HOME}/.env")
fi
if [[ -f "${project_root}/.env" ]]; then
  env_files+=(--env-file "${project_root}/.env")
fi

docker compose "${env_files[@]}" up --build "$@"
