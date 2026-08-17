ALTER TABLE agent_settings ADD COLUMN profile_material_id uuid;

ALTER TABLE agent_settings
  ADD CONSTRAINT agent_settings_profile_material_fk
  FOREIGN KEY (profile_material_id) REFERENCES materials(id) ON DELETE SET NULL;
