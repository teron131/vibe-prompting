-- Persists optional agent-workspace controls without making a saved prompt mandatory for general chat.

ALTER TABLE chats
  ADD COLUMN workspace_context_json jsonb NOT NULL DEFAULT '{}'::jsonb;
