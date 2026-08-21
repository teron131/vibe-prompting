-- Separates the product-wide active prompt revision from the editor history cursor.

ALTER TABLE prompts
  ADD COLUMN active_revision_id uuid;

UPDATE prompts
SET active_revision_id = current_revision_id;

ALTER TABLE prompts
  ALTER COLUMN active_revision_id SET NOT NULL,
  ADD CONSTRAINT prompts_active_revision
  FOREIGN KEY (id, active_revision_id)
  REFERENCES prompt_revisions(prompt_id, id)
  DEFERRABLE INITIALLY DEFERRED;
