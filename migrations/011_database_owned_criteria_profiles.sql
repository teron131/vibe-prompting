-- Removes the application-defined profile tier while preserving every persisted criteria profile.

ALTER TABLE evaluation_criteria_profiles
  DROP COLUMN is_default;
