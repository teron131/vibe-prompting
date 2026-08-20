-- Allows the vanilla AI SDK agent to persist without inventing extra runtime instructions.

ALTER TABLE target_profile_revisions
  DROP CONSTRAINT target_profile_revisions_instructions_check;
