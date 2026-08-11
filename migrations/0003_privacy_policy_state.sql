CREATE TABLE privacy_policy_states (
  owner_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
