-- Adds durable synthetic-example provenance so evaluation reports label seeded demonstrations without inferring from their contents.

ALTER TABLE evaluation_runs
  ADD COLUMN is_synthetic_example boolean NOT NULL DEFAULT false;

UPDATE evaluation_runs
SET is_synthetic_example = true
WHERE id = '2f9a8425-b58a-4c5d-a229-6df4e838afba';
