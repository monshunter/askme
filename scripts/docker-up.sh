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

detached=false
for argument in "$@"; do
  if [[ "${argument}" == "-d" || "${argument}" == "--detach" ]]; then
    detached=true
    break
  fi
done

if [[ "${detached}" == true && "${ASKME_SKIP_AGENT_RUNNER:-0}" != "1" ]]; then
  runner_state_root="${ASKME_AGENT_RUNNER_STATE_ROOT:-${project_root}/data/agent-runner}"
  mkdir -p "${runner_state_root}"
  nohup "${project_root}/scripts/agent-runner.sh" >> "${runner_state_root}/nohup.log" 2>&1 &
  printf '%s\n' "Askme Agent Runner start requested with nohup (launcher PID $!, log ${runner_state_root}/nohup.log)."
fi
