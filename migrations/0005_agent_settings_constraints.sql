ALTER TABLE agent_settings ADD CONSTRAINT agent_settings_answer_tone_allowed
  CHECK (answer_tone IN ('professional','concise','conversational'));
ALTER TABLE agent_settings ADD CONSTRAINT agent_settings_suggested_questions_array
  CHECK (jsonb_typeof(suggested_questions) = 'array' AND jsonb_array_length(suggested_questions) BETWEEN 0 AND 6);
