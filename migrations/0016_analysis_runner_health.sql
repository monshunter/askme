CREATE TABLE analysis_runner_heartbeats (
  runner_id text PRIMARY KEY,
  version text NOT NULL,
  image_digest text,
  artifact_ready boolean NOT NULL DEFAULT false,
  boxlite_ready boolean NOT NULL DEFAULT false,
  safe_error_code text,
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX analysis_runner_heartbeats_last_seen_idx ON analysis_runner_heartbeats(last_seen_at DESC);
