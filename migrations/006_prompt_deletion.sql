-- Makes prompt deletion cascade through evaluation history without coupling PromptSystem to evaluation tables.

ALTER TABLE evaluation_runs
  DROP CONSTRAINT evaluation_runs_prompt_id_fkey,
  DROP CONSTRAINT evaluation_runs_prompt_id_prompt_revision_id_fkey;

ALTER TABLE evaluation_runs
  ADD CONSTRAINT evaluation_runs_prompt_id_fkey
  FOREIGN KEY (prompt_id)
  REFERENCES prompts(id)
  ON DELETE CASCADE,
  ADD CONSTRAINT evaluation_runs_prompt_id_prompt_revision_id_fkey
  FOREIGN KEY (prompt_id, prompt_revision_id)
  REFERENCES prompt_revisions(prompt_id, id)
  ON DELETE CASCADE;
