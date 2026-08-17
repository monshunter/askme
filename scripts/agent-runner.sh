#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
state_root="${ASKME_AGENT_RUNNER_STATE_ROOT:-${project_root}/data/agent-runner}"
lock_dir="${state_root}/lock"
pid_file="${state_root}/pid"

mkdir -p "${state_root}"
if ! mkdir "${lock_dir}" 2>/dev/null; then
  for _ in 1 2 3; do
    existing_pid="$(sed -n '1p' "${pid_file}" 2>/dev/null || true)"
    if [[ "${existing_pid}" =~ ^[0-9]+$ ]] && kill -0 "${existing_pid}" 2>/dev/null; then
      printf '%s\n' "Askme Agent Runner is already running with PID ${existing_pid}."
      exit 0
    fi
    sleep 1
  done
  rm -f "${pid_file}"
  rmdir "${lock_dir}" 2>/dev/null || true
  mkdir "${lock_dir}"
fi

printf '%s\n' "$$" > "${pid_file}"
cleanup() {
  rm -f "${pid_file}"
  rmdir "${lock_dir}" 2>/dev/null || true
}
trap cleanup EXIT

cd "${project_root}"
npm run agent-runner
