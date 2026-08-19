-- Creates database-owned Target profiles, immutable runtime revisions, and evaluation provenance that pins the exact effective configuration.

CREATE TABLE target_profiles (
  id uuid PRIMARY KEY,
  name text NOT NULL CHECK (btrim(name) <> ''),
  prompt_id uuid NOT NULL UNIQUE REFERENCES prompts(id) ON DELETE CASCADE,
  current_revision_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE target_profile_revisions (
  id uuid PRIMARY KEY,
  target_profile_id uuid NOT NULL REFERENCES target_profiles(id) ON DELETE CASCADE,
  parent_revision_id uuid,
  revision_number integer NOT NULL CHECK (revision_number > 0),
  instructions text NOT NULL CHECK (btrim(instructions) <> ''),
  configuration jsonb NOT NULL CHECK (jsonb_typeof(configuration) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (target_profile_id, id),
  UNIQUE (target_profile_id, revision_number),
  FOREIGN KEY (target_profile_id, parent_revision_id)
    REFERENCES target_profile_revisions(target_profile_id, id)
    DEFERRABLE INITIALLY DEFERRED
);

ALTER TABLE target_profiles
  ADD CONSTRAINT target_profiles_current_revision
  FOREIGN KEY (id, current_revision_id)
  REFERENCES target_profile_revisions(target_profile_id, id)
  DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE evaluation_runs
  ADD COLUMN target_profile_id uuid REFERENCES target_profiles(id),
  ADD COLUMN target_profile_revision_id uuid,
  ADD COLUMN effective_instructions_hash text;

ALTER TABLE evaluation_runs
  ADD CONSTRAINT evaluation_runs_target_profile_revision
  FOREIGN KEY (target_profile_id, target_profile_revision_id)
  REFERENCES target_profile_revisions(target_profile_id, id),
  ADD CONSTRAINT evaluation_runs_target_provenance
  CHECK (
    (target_profile_id IS NULL
      AND target_profile_revision_id IS NULL
      AND effective_instructions_hash IS NULL)
    OR
    (target_profile_id IS NOT NULL
      AND target_profile_revision_id IS NOT NULL
      AND btrim(effective_instructions_hash) <> '')
  );

CREATE INDEX evaluation_runs_target_profile_created_at_idx
  ON evaluation_runs(target_profile_id, created_at DESC, id DESC);
