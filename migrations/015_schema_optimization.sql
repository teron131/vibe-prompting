-- Reconciles deployed evaluation provenance, removes write-only storage, and aligns indexes with active query paths.

ALTER TABLE evaluation_runs
  DROP CONSTRAINT evaluation_runs_target_provenance,
  DROP COLUMN IF EXISTS target_configuration_json;

ALTER TABLE evaluation_runs
  ADD CONSTRAINT evaluation_runs_target_provenance
  CHECK (
    (target_profile_id IS NULL
      AND target_profile_revision_id IS NULL
      AND effective_instructions_hash IS NULL)
    OR
    (target_profile_id IS NOT NULL
      AND target_profile_revision_id IS NOT NULL
      AND btrim(effective_instructions_hash) <> '')
  );

ALTER TABLE application_settings
  DROP COLUMN updated_at;

ALTER TABLE search_embeddings
  DROP COLUMN indexed_at;

ALTER TABLE chat_usage_events
  DROP CONSTRAINT chat_usage_events_pkey,
  DROP COLUMN id;

DROP INDEX chats_title_search_idx;
DROP INDEX chat_messages_text_search_idx;
DROP INDEX evaluation_runs_target_profile_created_at_idx;

DROP INDEX evaluation_runs_fingerprint_idx;
CREATE INDEX evaluation_runs_fingerprint_idx
  ON evaluation_runs(prompt_id, configuration_fingerprint, status, completed_at, id);

DROP INDEX model_cost_events_recorded_at_idx;
CREATE INDEX model_cost_events_window_idx
  ON model_cost_events(recorded_at, id);
