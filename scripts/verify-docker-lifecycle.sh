#!/usr/bin/env bash
set -euo pipefail

acceptance_project="askme-acceptance-$(date +%s)-$$"
acceptance_postgres_volume="${acceptance_project}_pgdata"
acceptance_upload_volume="${acceptance_project}_uploads"
acceptance_state_path="/data/uploads/.askme-acceptance/${acceptance_project}.json"
acceptance_secret_sentinel="ASKME_SECRET_${acceptance_project}"
acceptance_database_secret="ASKME_DB_SECRET_${acceptance_project}"

if [[ ! "${acceptance_project}" =~ ^askme-acceptance-[0-9]+-[0-9]+$ ]]; then
  echo "Refusing an invalid acceptance project name" >&2
  exit 2
fi
if [[ "${acceptance_postgres_volume}" != "${acceptance_project}_pgdata" || "${acceptance_upload_volume}" != "${acceptance_project}_uploads" ]]; then
  echo "Refusing invalid acceptance volume names" >&2
  exit 2
fi

export ASKME_POSTGRES_PORT=0
export ASKME_WEB_PORT=0
export ASKME_POSTGRES_VOLUME="${acceptance_postgres_volume}"
export ASKME_UPLOAD_VOLUME="${acceptance_upload_volume}"
export ASKME_CANDIDATE_EMAIL="candidate@acceptance.local"
export ASKME_CANDIDATE_PASSWORD="Candidate-acceptance-2026!"
export ASKME_ADMIN_EMAIL="admin@acceptance.local"
export ASKME_ADMIN_PASSWORD="Admin-acceptance-2026!"
export ASKME_SMTP_PASSWORD="${acceptance_secret_sentinel}"
export ASKME_POSTGRES_PASSWORD="${acceptance_database_secret}"

compose_command=(docker compose)
if [[ -f "${HOME}/.env" ]]; then
  compose_command+=(--env-file "${HOME}/.env")
fi
compose_command+=(-p "${acceptance_project}")

cleanup_acceptance() {
  if [[ "${acceptance_project}" =~ ^askme-acceptance-[0-9]+-[0-9]+$ && "${acceptance_postgres_volume}" == "${acceptance_project}_pgdata" && "${acceptance_upload_volume}" == "${acceptance_project}_uploads" ]]; then
    "${compose_command[@]}" down --volumes --remove-orphans >/dev/null 2>&1 || true
  fi
}
trap cleanup_acceptance EXIT
trap 'exit 130' INT TERM

for acceptance_volume in "${acceptance_postgres_volume}" "${acceptance_upload_volume}"; do
  if docker volume inspect "${acceptance_volume}" >/dev/null 2>&1; then
    echo "Refusing to overwrite existing volume: ${acceptance_volume}" >&2
    exit 2
  fi
done
if docker ps -a --filter "label=com.docker.compose.project=${acceptance_project}" --format '{{.ID}}' | grep -q .; then
  echo "Refusing to overwrite an existing acceptance project" >&2
  exit 2
fi

if scripts/docker-reset.sh >/dev/null 2>&1; then
  echo "docker-reset.sh accepted a missing confirmation" >&2
  exit 1
fi
if scripts/docker-reset.sh --confirm "${acceptance_project}" >/dev/null 2>&1; then
  echo "docker-reset.sh accepted the wrong project" >&2
  exit 1
fi

rendered_compose="$("${compose_command[@]}" config)"
grep -Fq "name: ${acceptance_postgres_volume}" <<<"${rendered_compose}"
grep -Fq "name: ${acceptance_upload_volume}" <<<"${rendered_compose}"

echo "Starting isolated Docker lifecycle acceptance: ${acceptance_project}"
"${compose_command[@]}" up --build -d

acceptance_endpoint=""
for _ in $(seq 1 120); do
  acceptance_endpoint="$("${compose_command[@]}" port web 3000 2>/dev/null || true)"
  if [[ -n "${acceptance_endpoint}" ]] && curl -fsS "http://${acceptance_endpoint}/api/health/ready" 2>/dev/null | grep -Fq '"status":"ready"'; then
    break
  fi
  sleep 1
done
if [[ -z "${acceptance_endpoint}" ]]; then
  echo "The isolated Web port was not published" >&2
  exit 1
fi
acceptance_ready="$(curl -fsS "http://${acceptance_endpoint}/api/health/ready")"
grep -Fq '"status":"ready"' <<<"${acceptance_ready}"
grep -Fq '"ai":"configured"' <<<"${acceptance_ready}"

runtime_exec=(
  "${compose_command[@]}" exec -T
  -e "ASKME_BASE_URL=http://127.0.0.1:3000"
  -e "ASKME_CANDIDATE_EMAIL=${ASKME_CANDIDATE_EMAIL}"
  -e "ASKME_CANDIDATE_PASSWORD=${ASKME_CANDIDATE_PASSWORD}"
  -e "ASKME_ACCEPTANCE_PROJECT=${acceptance_project}"
  -e "ASKME_ACCEPTANCE_MARKER=${acceptance_project}"
  -e "ASKME_ACCEPTANCE_STATE_PATH=${acceptance_state_path}"
  web npm run smoke:runtime-state --
)

"${runtime_exec[@]}" seed
"${compose_command[@]}" restart db web worker

acceptance_endpoint=""
for _ in $(seq 1 120); do
  acceptance_endpoint="$("${compose_command[@]}" port web 3000 2>/dev/null || true)"
  if [[ -n "${acceptance_endpoint}" ]] && curl -fsS "http://${acceptance_endpoint}/api/health/ready" 2>/dev/null | grep -Fq '"status":"ready"'; then
    break
  fi
  sleep 1
done
curl -fsS "http://${acceptance_endpoint}/api/health/ready" | grep -Fq '"status":"ready"'
"${runtime_exec[@]}" verify

acceptance_logs="$("${compose_command[@]}" logs --no-color)"
grep -Fq '"event":"worker.material.indexed"' <<<"${acceptance_logs}"
grep -Fq '"jobId"' <<<"${acceptance_logs}"
deepseek_secret="$(docker inspect "${acceptance_project}-web-1" --format '{{range .Config.Env}}{{println .}}{{end}}' | sed -n 's/^DEEPSEEK_API_KEY=//p')"
for forbidden_log_value in \
  "${acceptance_secret_sentinel}" \
  "${acceptance_database_secret}" \
  "${ASKME_CANDIDATE_PASSWORD}" \
  "${ASKME_ADMIN_PASSWORD}" \
  "ASKME_PRIVATE_TEXT_${acceptance_project}" \
  "${deepseek_secret}"; do
  if [[ -n "${forbidden_log_value}" ]] && grep -Fq "${forbidden_log_value}" <<<"${acceptance_logs}"; then
    echo "A Secret or private-text sentinel appeared in application logs" >&2
    exit 1
  fi
done

echo "Docker lifecycle acceptance passed: ${acceptance_project}"
cleanup_acceptance
trap - INT TERM EXIT

for acceptance_volume in "${acceptance_postgres_volume}" "${acceptance_upload_volume}"; do
  if docker volume inspect "${acceptance_volume}" >/dev/null 2>&1; then
    echo "Acceptance volume was not removed: ${acceptance_volume}" >&2
    exit 1
  fi
done
