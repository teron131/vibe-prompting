-- Pins the main-chat reasoning effort on every Target Run so execution traces remain reproducible.

ALTER TABLE target_runs
  ADD COLUMN reasoning_effort text NOT NULL DEFAULT 'medium'
  CHECK (reasoning_effort IN ('low', 'medium', 'high', 'xhigh'));
