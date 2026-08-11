CREATE TYPE admin_invitation_status AS ENUM ('pending','sent','accepted','failed','revoked');

CREATE TABLE admin_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email citext NOT NULL,
  display_name text NOT NULL CHECK (length(btrim(display_name)) BETWEEN 1 AND 120),
  token_hash text NOT NULL UNIQUE CHECK (length(token_hash) = 64),
  status admin_invitation_status NOT NULL DEFAULT 'pending',
  invited_by uuid REFERENCES users(id) ON DELETE SET NULL,
  expires_at timestamptz NOT NULL,
  sent_at timestamptz,
  accepted_at timestamptz,
  failed_at timestamptz,
  revoked_at timestamptz,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at),
  CHECK (
    (status = 'pending' AND sent_at IS NULL AND accepted_at IS NULL AND failed_at IS NULL AND revoked_at IS NULL) OR
    (status = 'sent' AND sent_at IS NOT NULL AND accepted_at IS NULL AND failed_at IS NULL AND revoked_at IS NULL) OR
    (status = 'accepted' AND sent_at IS NOT NULL AND accepted_at IS NOT NULL AND failed_at IS NULL AND revoked_at IS NULL) OR
    (status = 'failed' AND accepted_at IS NULL AND failed_at IS NOT NULL AND revoked_at IS NULL AND error_code IS NOT NULL) OR
    (status = 'revoked' AND accepted_at IS NULL AND revoked_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX admin_invitations_active_email_unique
  ON admin_invitations(lower(email::text)) WHERE status IN ('pending','sent');
CREATE INDEX admin_invitations_status_created_idx ON admin_invitations(status,created_at DESC);

WITH duplicate_flags AS (
  SELECT id,row_number() OVER (
    PARTITION BY message_id,category
    ORDER BY updated_at DESC,created_at DESC,id DESC
  ) AS duplicate_rank
  FROM content_flags
  WHERE message_id IS NOT NULL
)
DELETE FROM content_flags flag
USING duplicate_flags duplicate
WHERE flag.id=duplicate.id AND duplicate.duplicate_rank>1;

UPDATE content_flags
SET status='open',reviewed_by=NULL,decision_note=NULL,reviewed_at=NULL,updated_at=now()
WHERE
  (status='open' AND (reviewed_by IS NOT NULL OR reviewed_at IS NOT NULL OR decision_note IS NOT NULL)) OR
  (status IN ('reviewing','resolved','dismissed') AND (reviewed_by IS NULL OR reviewed_at IS NULL)) OR
  (status IN ('resolved','dismissed') AND length(btrim(coalesce(decision_note,'')))=0);

CREATE UNIQUE INDEX content_flags_message_category_unique
  ON content_flags(message_id,category) WHERE message_id IS NOT NULL;

ALTER TABLE content_flags ADD CONSTRAINT content_flags_review_state
  CHECK (
    (status='open' AND reviewed_by IS NULL AND reviewed_at IS NULL AND decision_note IS NULL) OR
    (status='reviewing' AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL) OR
    (status IN ('resolved','dismissed') AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL AND length(btrim(coalesce(decision_note,''))) BETWEEN 3 AND 500)
  );

UPDATE publications
SET pause_reason='Paused by platform governance.',updated_at=now()
WHERE status='paused' AND length(btrim(coalesce(pause_reason,'')))<3;

ALTER TABLE publications ADD CONSTRAINT publications_paused_reason
  CHECK (status <> 'paused' OR length(btrim(coalesce(pause_reason,''))) BETWEEN 3 AND 500);

CREATE INDEX users_role_status_created_idx ON users(role,status,created_at DESC);
CREATE INDEX publications_status_published_idx ON publications(status,published_at DESC);
CREATE INDEX conversations_mode_activity_idx ON conversations(mode,last_activity_at DESC);
CREATE INDEX content_flags_created_idx ON content_flags(created_at DESC);
