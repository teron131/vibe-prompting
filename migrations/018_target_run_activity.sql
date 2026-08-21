-- Adds durable reasoning and tool activity to Target Run turns without mixing observability data into replay messages.

ALTER TABLE target_run_turns
  ADD COLUMN activity_json jsonb NOT NULL DEFAULT '[]'::jsonb;
