-- Stores reusable, ordered evaluation criteria profiles independently from individual run snapshots.

CREATE TABLE evaluation_criteria_profiles (
  id uuid PRIMARY KEY,
  name text NOT NULL CHECK (btrim(name) <> ''),
  criteria_json jsonb NOT NULL CHECK (
    jsonb_typeof(criteria_json) = 'array'
    AND jsonb_array_length(criteria_json) > 0
  ),
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX evaluation_criteria_profiles_name_idx
  ON evaluation_criteria_profiles (lower(btrim(name)));
