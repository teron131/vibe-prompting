-- Removes profile timestamps that no backend contract reads or exposes.

ALTER TABLE evaluation_criteria_profiles
  DROP COLUMN created_at,
  DROP COLUMN updated_at;

ALTER TABLE target_profiles
  DROP COLUMN created_at,
  DROP COLUMN updated_at;

ALTER TABLE target_profile_revisions
  DROP COLUMN created_at;
