-- Caches current-revision prompt chunks for hybrid keyword and semantic search.

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
