CREATE TABLE analysis_quota_usage (
  scope_type text NOT NULL CHECK (scope_type IN ('global','candidate','repository','publication','visitor')),
  scope_key text NOT NULL CHECK (length(scope_key) BETWEEN 1 AND 200),
  window_started_at timestamptz NOT NULL,
  used integer NOT NULL DEFAULT 0 CHECK (used >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(scope_type,scope_key,window_started_at)
);

CREATE INDEX analysis_quota_usage_window_idx ON analysis_quota_usage(window_started_at);
