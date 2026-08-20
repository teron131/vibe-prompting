-- Replaces prompt-owned embedding storage with a target-agnostic hybrid-search cache.

CREATE TABLE search_embeddings (
  target text NOT NULL CHECK (btrim(target) <> ''),
  document_id text NOT NULL CHECK (btrim(document_id) <> ''),
  owner_id uuid NOT NULL,
  content_hash text NOT NULL,
  model text NOT NULL,
  embedding jsonb NOT NULL CHECK (jsonb_typeof(embedding) = 'array'),
  indexed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (target, document_id)
);

INSERT INTO search_embeddings (
  target,
  document_id,
  owner_id,
  content_hash,
  model,
  embedding,
  indexed_at
)
SELECT
  'prompt',
  prompt_id::text || ':' || chunk_index::text,
  prompt_id,
  content_hash,
  model,
  embedding,
  indexed_at
FROM prompt_search_embeddings;

DROP TABLE prompt_search_embeddings;
