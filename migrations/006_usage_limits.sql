-- Persists deployment-wide chat and model-usage events independently from conversations so deletion and restarts cannot reset safety boundaries.

CREATE TABLE chat_usage_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  accepted_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX chat_usage_events_accepted_at_idx
  ON chat_usage_events(accepted_at);

CREATE TABLE model_cost_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  model_id text NOT NULL,
  input_tokens bigint NOT NULL CHECK (input_tokens >= 0),
  output_tokens bigint NOT NULL CHECK (output_tokens >= 0),
  estimated_cost_usd numeric(12, 6) NOT NULL CHECK (estimated_cost_usd >= 0),
  recorded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX model_cost_events_recorded_at_idx
  ON model_cost_events(recorded_at);
