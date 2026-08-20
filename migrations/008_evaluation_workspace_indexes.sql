-- Adds read-model indexes for chronological result pagination and the evaluation workspace's bounded filters.

CREATE INDEX evaluation_runs_workspace_created_at_idx
  ON evaluation_runs(created_at DESC, id DESC);

CREATE INDEX evaluation_runs_workspace_filter_idx
  ON evaluation_runs(prompt_id, prompt_revision_id, target_model_id, status, created_at DESC, id DESC);

CREATE INDEX evaluation_scores_workspace_filter_idx
  ON evaluation_scores(judge_model_id, data_type, case_id);
