#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
user_env_file="${HOME}/.env"

read_user_env() {
  local key="$1"
  [[ -f "${user_env_file}" ]] || return 0
  node -e 'const fs=require("node:fs"); const [file,key]=process.argv.slice(1); const source=fs.readFileSync(file,"utf8"); const escaped=key.replace(/[.*+?^${}()|[\]\\]/g,"\\$&"); const match=source.match(new RegExp(`^\\s*(?:export\\s+)?${escaped}\\s*=\\s*(.*?)\\s*$`,"m")); if(match){let value=match[1].trim(); if(value.length>=2&&((value.startsWith("\"")&&value.endsWith("\""))||(value.startsWith("'\''")&&value.endsWith("'\''"))))value=value.slice(1,-1); process.stdout.write(value);}' "${user_env_file}" "${key}"
}

postgres_user="${ASKME_POSTGRES_USER:-$(read_user_env ASKME_POSTGRES_USER)}"
postgres_password="${ASKME_POSTGRES_PASSWORD:-$(read_user_env ASKME_POSTGRES_PASSWORD)}"
postgres_database="${ASKME_POSTGRES_DB:-$(read_user_env ASKME_POSTGRES_DB)}"
postgres_port="${ASKME_POSTGRES_PORT:-$(read_user_env ASKME_POSTGRES_PORT)}"
database_url="${DATABASE_URL:-$(read_user_env DATABASE_URL)}"
artifact_root="${ASKME_REPOSITORY_ARTIFACT_HOST_ROOT:-$(read_user_env ASKME_REPOSITORY_ARTIFACT_HOST_ROOT)}"
rootfs_path="${ASKME_CODE_AGENT_ROOTFS_PATH:-$(read_user_env ASKME_CODE_AGENT_ROOTFS_PATH)}"
runtime_root="${ASKME_CODE_AGENT_RUNTIME_ROOT:-$(read_user_env ASKME_CODE_AGENT_RUNTIME_ROOT)}"
configured_digest="${ASKME_CODE_AGENT_IMAGE_DIGEST:-$(read_user_env ASKME_CODE_AGENT_IMAGE_DIGEST)}"

postgres_user="${postgres_user:-askme}"
postgres_password="${postgres_password:-askme-local-only}"
postgres_database="${postgres_database:-askme}"
postgres_port="${postgres_port:-55432}"
export DATABASE_URL="${database_url:-postgresql://${postgres_user}:${postgres_password}@127.0.0.1:${postgres_port}/${postgres_database}}"
export ASKME_REPOSITORY_ARTIFACT_ROOT="${artifact_root:-${project_root}/data/repository-artifacts}"
export ASKME_CODE_AGENT_ROOTFS_PATH="${rootfs_path:-${project_root}/data/code-agent-image}"
export ASKME_CODE_AGENT_RUNTIME_ROOT="${runtime_root:-${project_root}/data/boxlite}"
export ASKME_CODE_AGENT_IMAGE_DIGEST="${configured_digest}"
unset ASKME_GITHUB_TEST_TOKEN

if [[ -z "${ASKME_CODE_AGENT_IMAGE_DIGEST}" ]]; then
  image_digest="$(node -e 'const fs=require("node:fs"); const path=process.argv[1]; const index=JSON.parse(fs.readFileSync(`${path}/index.json`,"utf8")); const value=index.manifests?.[0]?.digest; if(!/^sha256:[0-9a-f]{64}$/.test(value??"")) process.exit(1); process.stdout.write(value)' "${ASKME_CODE_AGENT_ROOTFS_PATH}")"
  export ASKME_CODE_AGENT_IMAGE_DIGEST="${image_digest}"
fi

cd "${project_root}"
exec npm run agent-runner
