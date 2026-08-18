-- Removes prompt ownership from conversations so prompts become optional message artifacts.

ALTER TABLE chats
  DROP COLUMN prompt_id;

ALTER TABLE chats
  ALTER COLUMN icon SET DEFAULT 'chat';

UPDATE chats
SET icon = 'chat'
WHERE icon = 'prompt';

ALTER TABLE chat_messages
  DROP COLUMN prompt_revision_id;
