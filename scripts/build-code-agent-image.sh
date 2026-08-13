#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
output_root="${ASKME_CODE_AGENT_ROOTFS_PATH:-${project_root}/data/code-agent-image}"
temporary_root="$(mktemp -d "${TMPDIR:-/tmp}/askme-code-agent-image.XXXXXX")"
trap 'rm -rf "${temporary_root}"' EXIT

docker buildx build \
  --platform "linux/$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/')" \
  --output "type=oci,dest=${temporary_root}/image.tar" \
  -f "${project_root}/src/server/code-agent/sandbox/Dockerfile" \
  "${project_root}"

mkdir -p "${temporary_root}/layout"
tar -xf "${temporary_root}/image.tar" -C "${temporary_root}/layout"
image_digest="$(node -e 'const fs=require("node:fs"); const path=process.argv[1]; const index=JSON.parse(fs.readFileSync(`${path}/index.json`,"utf8")); const value=index.manifests?.[0]?.digest; if(!/^sha256:[0-9a-f]{64}$/.test(value??"")) process.exit(1); process.stdout.write(value)' "${temporary_root}/layout")"

mkdir -p "$(dirname "${output_root}")"
if [[ -e "${output_root}" ]]; then
  backup_root="${output_root}.previous.$$"
  mv "${output_root}" "${backup_root}"
  mv "${temporary_root}/layout" "${output_root}"
  rm -rf "${backup_root}"
else
  mv "${temporary_root}/layout" "${output_root}"
fi

printf '%s\n' "ASKME_CODE_AGENT_ROOTFS_PATH=${output_root}"
printf '%s\n' "ASKME_CODE_AGENT_IMAGE_DIGEST=${image_digest}"
