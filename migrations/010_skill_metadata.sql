-- Store validated skill metadata beside immutable Markdown so catalogue queries stay lightweight.
ALTER TABLE prompt_revisions ADD COLUMN skill jsonb;
ALTER TABLE prompt_revisions ADD CONSTRAINT prompt_revision_skill_metadata CHECK (
  skill IS NULL OR (
    jsonb_typeof(skill) = 'object'
    AND jsonb_typeof(skill -> 'name') = 'string'
    AND jsonb_typeof(skill -> 'description') = 'string'
  )
);
