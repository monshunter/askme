CREATE INDEX conversations_public_expiry_idx
  ON conversations(expires_at) WHERE mode='public';
