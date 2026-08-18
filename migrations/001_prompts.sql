-- Stores prompt identity separately from its immutable Markdown revision history.

CREATE TABLE prompts (
  id uuid PRIMARY KEY,
  title text NOT NULL CHECK (btrim(title) <> ''),
  current_revision_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE prompt_revisions (
  id uuid PRIMARY KEY,
  prompt_id uuid NOT NULL REFERENCES prompts(id) ON DELETE CASCADE,
  parent_revision_id uuid,
  markdown text NOT NULL,
  change_request text,
  source text NOT NULL CHECK (source IN ('user', 'operator')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (prompt_id, id),
  FOREIGN KEY (prompt_id, parent_revision_id)
    REFERENCES prompt_revisions(prompt_id, id)
    DEFERRABLE INITIALLY DEFERRED
);

ALTER TABLE prompts
  ADD CONSTRAINT prompts_current_revision
  FOREIGN KEY (id, current_revision_id)
  REFERENCES prompt_revisions(prompt_id, id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX prompt_revisions_prompt_created_at_idx
  ON prompt_revisions(prompt_id, created_at DESC);
