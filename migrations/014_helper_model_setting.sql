-- Makes the helper model a durable application setting while allowing runtime defaults to backfill existing workspaces.

ALTER TABLE application_settings
ADD COLUMN helper_model jsonb;
