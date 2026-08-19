-- Creates general conversations, reconstructable messages, and persisted workspace state.

CREATE TABLE chats (
  id uuid PRIMARY KEY,
  title text NOT NULL CHECK (btrim(title) <> ''),
  icon text NOT NULL DEFAULT 'message-circle',
  model_id text NOT NULL CHECK (btrim(model_id) <> ''),
  workspace_context_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE chat_messages (
  id uuid PRIMARY KEY,
  chat_id uuid NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  parts_json jsonb NOT NULL,
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  text_content text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX chats_updated_at_idx
  ON chats(updated_at DESC, id DESC);

CREATE INDEX chats_title_search_idx
  ON chats USING gin(to_tsvector('simple', title));

CREATE INDEX chat_messages_chat_created_at_idx
  ON chat_messages(chat_id, created_at, id);

CREATE INDEX chat_messages_text_search_idx
  ON chat_messages USING gin(to_tsvector('simple', text_content));
