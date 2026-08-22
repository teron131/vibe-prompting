-- Resets disposable development artifacts and makes user ownership and attribution mandatory across application writes.

DELETE FROM evaluation_scores;
DELETE FROM evaluation_cases;
DELETE FROM evaluation_runs;
DELETE FROM target_run_turns;
DELETE FROM target_runs;
DELETE FROM chat_messages;
DELETE FROM chats;
DELETE FROM search_embeddings;
DELETE FROM target_profile_revisions;
DELETE FROM target_profiles;
DELETE FROM prompt_revisions;
DELETE FROM prompts;
DELETE FROM evaluation_criteria_profiles;
DELETE FROM chat_usage_events;
DELETE FROM model_cost_events;

SET CONSTRAINTS ALL IMMEDIATE;

ALTER TABLE chats
  ADD COLUMN owner_user_id uuid NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE;

ALTER TABLE prompt_revisions
  ADD COLUMN created_by_user_id uuid NOT NULL REFERENCES auth_users(id);

ALTER TABLE target_profile_revisions
  ADD COLUMN created_by_user_id uuid NOT NULL REFERENCES auth_users(id);

ALTER TABLE evaluation_runs
  ADD COLUMN started_by_user_id uuid NOT NULL REFERENCES auth_users(id);

ALTER TABLE target_runs
  ADD COLUMN started_by_user_id uuid NOT NULL REFERENCES auth_users(id);

ALTER TABLE target_run_turns
  ADD COLUMN created_by_user_id uuid NOT NULL REFERENCES auth_users(id);

ALTER TABLE evaluation_criteria_profiles
  ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  ADD COLUMN created_by_user_id uuid NOT NULL REFERENCES auth_users(id),
  ADD COLUMN updated_by_user_id uuid NOT NULL REFERENCES auth_users(id);

ALTER TABLE application_settings
  ADD COLUMN revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  ADD COLUMN updated_by_user_id uuid REFERENCES auth_users(id);

ALTER TABLE prompts
  DROP CONSTRAINT prompts_current_revision,
  DROP COLUMN current_revision_id,
  DROP COLUMN redo_revision_ids;

DROP INDEX chats_updated_at_idx;

CREATE INDEX chats_owner_updated_at_idx
  ON chats(owner_user_id, updated_at DESC, id DESC);

CREATE INDEX prompt_revisions_created_by_user_id_idx
  ON prompt_revisions(created_by_user_id);

CREATE INDEX target_profile_revisions_created_by_user_id_idx
  ON target_profile_revisions(created_by_user_id);

CREATE INDEX evaluation_runs_started_by_user_id_idx
  ON evaluation_runs(started_by_user_id);

CREATE INDEX target_runs_started_by_user_id_idx
  ON target_runs(started_by_user_id);

CREATE INDEX target_run_turns_created_by_user_id_idx
  ON target_run_turns(created_by_user_id);
