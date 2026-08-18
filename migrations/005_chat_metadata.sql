-- Aligns persisted chat metadata defaults with generated Lucide history icons.

ALTER TABLE chats
  ALTER COLUMN icon SET DEFAULT 'message-circle';

UPDATE chats
SET icon = 'message-circle'
WHERE icon = 'chat';
