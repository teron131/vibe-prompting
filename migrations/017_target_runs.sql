-- Creates prompt-revision-pinned multi-turn Target Runs and links recorded-trace evaluations to their immutable source turn.

CREATE TABLE target_runs (
  id uuid PRIMARY KEY,
  prompt_id uuid NOT NULL REFERENCES prompts(id) ON DELETE CASCADE,
  prompt_revision_id uuid NOT NULL,
  target_profile_id uuid NOT NULL REFERENCES target_profiles(id),
  target_profile_revision_id uuid NOT NULL,
  target_model_id text NOT NULL CHECK (btrim(target_model_id) <> ''),
  effective_instructions_hash text NOT NULL CHECK (btrim(effective_instructions_hash) <> ''),
  source text NOT NULL CHECK (source IN ('human', 'ai')),
  chat_id uuid REFERENCES chats(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (prompt_id, prompt_revision_id)
    REFERENCES prompt_revisions(prompt_id, id),
  FOREIGN KEY (target_profile_id, target_profile_revision_id)
    REFERENCES target_profile_revisions(target_profile_id, id)
);

CREATE TABLE target_run_turns (
  id uuid PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES target_runs(id) ON DELETE CASCADE,
  position integer NOT NULL CHECK (position >= 0),
  input_text text NOT NULL CHECK (btrim(input_text) <> ''),
  output_text text,
  response_messages_json jsonb,
  usage_json jsonb,
  status text NOT NULL CHECK (status IN ('running', 'completed', 'failed', 'interrupted')),
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (run_id, position)
);

CREATE UNIQUE INDEX target_run_turns_one_running_idx
  ON target_run_turns(run_id)
  WHERE status = 'running';

CREATE INDEX target_runs_prompt_updated_at_idx
  ON target_runs(prompt_id, updated_at DESC, id DESC);

ALTER TABLE evaluation_runs
  ADD COLUMN target_run_id uuid REFERENCES target_runs(id) ON DELETE SET NULL,
  ADD COLUMN target_run_turn_id uuid REFERENCES target_run_turns(id) ON DELETE SET NULL;

ALTER TABLE evaluation_runs
  ADD CONSTRAINT evaluation_runs_target_trace_source
  CHECK (
    (target_run_id IS NULL AND target_run_turn_id IS NULL)
    OR
    (target_run_id IS NOT NULL AND target_run_turn_id IS NOT NULL)
  );
