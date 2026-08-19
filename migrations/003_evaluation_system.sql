-- Creates prompt-linked evaluation runs, cases, and attributed criterion scores.

CREATE TABLE evaluation_runs (
  id uuid PRIMARY KEY,
  prompt_id uuid NOT NULL REFERENCES prompts(id),
  prompt_revision_id uuid NOT NULL,
  chat_id uuid REFERENCES chats(id) ON DELETE SET NULL,
  source text NOT NULL CHECK (source IN ('human', 'ai')),
  target_model_id text NOT NULL CHECK (btrim(target_model_id) <> ''),
  judge_model_ids text[] NOT NULL CHECK (cardinality(judge_model_ids) > 0),
  status text NOT NULL CHECK (status IN ('running', 'completed', 'failed', 'interrupted')),
  configuration_fingerprint text NOT NULL CHECK (btrim(configuration_fingerprint) <> ''),
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  FOREIGN KEY (prompt_id, prompt_revision_id)
    REFERENCES prompt_revisions(prompt_id, id)
);

CREATE TABLE evaluation_cases (
  id uuid PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES evaluation_runs(id) ON DELETE CASCADE,
  position integer NOT NULL CHECK (position >= 0),
  input_json jsonb NOT NULL,
  criteria_json jsonb NOT NULL,
  output_json jsonb,
  UNIQUE (run_id, position)
);

CREATE TABLE evaluation_scores (
  id uuid PRIMARY KEY,
  case_id uuid NOT NULL REFERENCES evaluation_cases(id) ON DELETE CASCADE,
  criterion_position integer NOT NULL CHECK (criterion_position >= 0),
  data_type text NOT NULL CHECK (data_type IN ('BOOLEAN', 'CATEGORICAL', 'CORRECTION', 'NUMERIC', 'TEXT')),
  criterion_json jsonb NOT NULL,
  judge_model_id text NOT NULL CHECK (btrim(judge_model_id) <> ''),
  value_json jsonb NOT NULL,
  comment text NOT NULL,
  evidence_json jsonb NOT NULL,
  UNIQUE (case_id, criterion_position, judge_model_id)
);

CREATE INDEX evaluation_runs_prompt_created_at_idx
  ON evaluation_runs(prompt_id, created_at DESC, id DESC);

CREATE INDEX evaluation_runs_fingerprint_idx
  ON evaluation_runs(configuration_fingerprint, status, created_at);
