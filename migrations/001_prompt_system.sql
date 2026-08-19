-- Creates durable prompts, immutable revisions, history navigation state, and derived search storage.

CREATE TABLE prompts (
  id uuid PRIMARY KEY,
  title text NOT NULL CHECK (btrim(title) <> ''),
  current_revision_id uuid NOT NULL,
  redo_revision_ids uuid[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE prompt_revisions (
  id uuid PRIMARY KEY,
  prompt_id uuid NOT NULL REFERENCES prompts(id) ON DELETE CASCADE,
  parent_revision_id uuid,
  revision_number integer NOT NULL CHECK (revision_number > 0),
  markdown text NOT NULL,
  change_request text,
  author text NOT NULL CHECK (author IN ('human', 'ai')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (prompt_id, id),
  UNIQUE (prompt_id, revision_number),
  FOREIGN KEY (prompt_id, parent_revision_id)
    REFERENCES prompt_revisions(prompt_id, id)
    DEFERRABLE INITIALLY DEFERRED
);

ALTER TABLE prompts
  ADD CONSTRAINT prompts_current_revision
  FOREIGN KEY (id, current_revision_id)
  REFERENCES prompt_revisions(prompt_id, id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE prompt_search_embeddings (
  prompt_id uuid NOT NULL REFERENCES prompts(id) ON DELETE CASCADE,
  chunk_index integer NOT NULL CHECK (chunk_index >= 0),
  revision_id uuid NOT NULL,
  content_hash text NOT NULL,
  model text NOT NULL,
  embedding jsonb NOT NULL CHECK (jsonb_typeof(embedding) = 'array'),
  indexed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (prompt_id, chunk_index),
  FOREIGN KEY (prompt_id, revision_id)
    REFERENCES prompt_revisions(prompt_id, id)
    ON DELETE CASCADE
);
