ALTER TABLE messages ADD COLUMN client_message_id text;
ALTER TABLE messages ADD COLUMN reply_to_message_id uuid REFERENCES messages(id) ON DELETE CASCADE;
ALTER TABLE messages ADD CONSTRAINT messages_client_message_id_format CHECK (
  client_message_id IS NULL OR client_message_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
);
ALTER TABLE messages ADD CONSTRAINT messages_client_id_user_only CHECK (client_message_id IS NULL OR role = 'user');
CREATE UNIQUE INDEX messages_conversation_client_unique ON messages(conversation_id,client_message_id);
CREATE UNIQUE INDEX messages_reply_unique ON messages(reply_to_message_id);
