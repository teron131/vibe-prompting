-- Adds durable evaluation queueing and terminal cancellation attribution for shared workflows.

ALTER TABLE evaluation_runs
  DROP CONSTRAINT evaluation_runs_status_check,
  ADD CONSTRAINT evaluation_runs_status_check
  CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled', 'interrupted')),
  ADD COLUMN cancelled_at timestamptz,
  ADD COLUMN cancelled_by_user_id uuid REFERENCES auth_users(id),
  ADD CONSTRAINT evaluation_runs_cancellation
  CHECK (
    (status = 'cancelled' AND cancelled_at IS NOT NULL AND cancelled_by_user_id IS NOT NULL)
    OR
    (status <> 'cancelled' AND cancelled_at IS NULL AND cancelled_by_user_id IS NULL)
  );

ALTER TABLE target_run_turns
  DROP CONSTRAINT target_run_turns_status_check,
  ADD CONSTRAINT target_run_turns_status_check
  CHECK (status IN ('running', 'completed', 'failed', 'cancelled', 'interrupted')),
  ADD COLUMN cancelled_at timestamptz,
  ADD COLUMN cancelled_by_user_id uuid REFERENCES auth_users(id),
  ADD CONSTRAINT target_run_turns_cancellation
  CHECK (
    (status = 'cancelled' AND cancelled_at IS NOT NULL AND cancelled_by_user_id IS NOT NULL)
    OR
    (status <> 'cancelled' AND cancelled_at IS NULL AND cancelled_by_user_id IS NULL)
  );

CREATE INDEX evaluation_runs_queue_idx
  ON evaluation_runs(status, created_at, id);
