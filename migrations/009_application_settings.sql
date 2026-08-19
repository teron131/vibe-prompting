-- Persists deployment-wide model choices and encrypted provider overrides independently from environment defaults.

CREATE TABLE application_settings (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  model_catalog jsonb NOT NULL,
  provider_overrides jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
