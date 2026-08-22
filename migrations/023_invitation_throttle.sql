-- Persists invitation failures so repeated guesses remain bounded across requests and process restarts.

ALTER TABLE auth_users
  ADD COLUMN invitation_attempt_count integer NOT NULL DEFAULT 0 CHECK (invitation_attempt_count >= 0),
  ADD COLUMN invitation_locked_until timestamptz;
