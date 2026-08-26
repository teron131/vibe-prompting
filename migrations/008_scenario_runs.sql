-- Persists static and generative Scenario lifecycle and evaluation handoff while Target Runs remain authoritative for conversation traces.

CREATE TABLE public.scenario_runs (
    id uuid PRIMARY KEY,
    prompt_id uuid NOT NULL,
    prompt_revision_id uuid NOT NULL,
    target_model_id text NOT NULL,
    reasoning_effort text NOT NULL,
    mode text NOT NULL,
    instruction_text text,
    static_messages_json jsonb,
    driver_model_id text,
    driver_brief text,
    max_turns integer,
    status text NOT NULL,
    target_run_id uuid UNIQUE,
    evaluation_plan_json jsonb,
    evaluation_runs_json jsonb DEFAULT '[]'::jsonb NOT NULL,
    evaluation_error_message text,
    stop_reason text,
    error_message text,
    source text NOT NULL,
    chat_id uuid,
    started_by_user_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    cancelled_at timestamp with time zone,
    cancelled_by_user_id uuid,
    CONSTRAINT scenario_runs_target_model_id_check CHECK ((btrim(target_model_id) <> ''::text)),
    CONSTRAINT scenario_runs_reasoning_effort_check CHECK ((reasoning_effort = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text, 'xhigh'::text]))),
    CONSTRAINT scenario_runs_mode_check CHECK ((mode = ANY (ARRAY['static'::text, 'generative'::text]))),
    CONSTRAINT scenario_runs_static_messages_check CHECK ((static_messages_json IS NULL) OR (jsonb_typeof(static_messages_json) = 'array'::text)),
    CONSTRAINT scenario_runs_max_turns_check CHECK ((max_turns IS NULL) OR ((max_turns >= 1) AND (max_turns <= 10))),
    CONSTRAINT scenario_runs_status_check CHECK ((status = ANY (ARRAY['queued'::text, 'running'::text, 'completed'::text, 'failed'::text, 'cancelled'::text, 'interrupted'::text]))),
    CONSTRAINT scenario_runs_source_check CHECK ((source = ANY (ARRAY['human'::text, 'ai'::text]))),
    CONSTRAINT scenario_runs_evaluation_plan_check CHECK ((evaluation_plan_json IS NULL) OR (jsonb_typeof(evaluation_plan_json) = 'object'::text)),
    CONSTRAINT scenario_runs_evaluation_runs_check CHECK ((jsonb_typeof(evaluation_runs_json) = 'array'::text)),
    CONSTRAINT scenario_runs_mode_configuration CHECK (
        ((mode = 'static'::text) AND (instruction_text IS NULL) AND (static_messages_json IS NOT NULL) AND (jsonb_array_length(static_messages_json) >= 1) AND (driver_model_id IS NULL) AND (max_turns IS NULL))
        OR
        ((mode = 'generative'::text) AND (instruction_text IS NOT NULL) AND (btrim(instruction_text) <> ''::text) AND (static_messages_json IS NULL) AND (driver_model_id IS NOT NULL) AND (btrim(driver_model_id) <> ''::text) AND (max_turns IS NOT NULL))
    ),
    CONSTRAINT scenario_runs_stop_reason_check CHECK (
        ((status = 'completed'::text) AND (((mode = 'static'::text) AND (stop_reason = 'static-complete'::text)) OR ((mode = 'generative'::text) AND (stop_reason = ANY (ARRAY['driver-ended'::text, 'maximum-turns'::text])))))
        OR
        ((status <> 'completed'::text) AND (stop_reason IS NULL))
    ),
    CONSTRAINT scenario_runs_cancellation CHECK (
        ((status = 'cancelled'::text) AND (cancelled_at IS NOT NULL) AND (cancelled_by_user_id IS NOT NULL))
        OR
        ((status <> 'cancelled'::text) AND (cancelled_at IS NULL) AND (cancelled_by_user_id IS NULL))
    ),
    CONSTRAINT scenario_runs_completion CHECK (
        ((status = ANY (ARRAY['queued'::text, 'running'::text])) AND (completed_at IS NULL))
        OR
        ((status = ANY (ARRAY['completed'::text, 'failed'::text, 'cancelled'::text, 'interrupted'::text])) AND (completed_at IS NOT NULL))
    ),
    CONSTRAINT scenario_runs_prompt_id_fkey FOREIGN KEY (prompt_id) REFERENCES public.prompts(id) ON DELETE CASCADE,
    CONSTRAINT scenario_runs_prompt_revision_fkey FOREIGN KEY (prompt_id, prompt_revision_id) REFERENCES public.prompt_revisions(prompt_id, id),
    CONSTRAINT scenario_runs_target_run_id_fkey FOREIGN KEY (target_run_id) REFERENCES public.target_runs(id) ON DELETE SET NULL,
    CONSTRAINT scenario_runs_chat_id_fkey FOREIGN KEY (chat_id) REFERENCES public.chats(id) ON DELETE SET NULL,
    CONSTRAINT scenario_runs_started_by_user_id_fkey FOREIGN KEY (started_by_user_id) REFERENCES public.auth_users(id),
    CONSTRAINT scenario_runs_cancelled_by_user_id_fkey FOREIGN KEY (cancelled_by_user_id) REFERENCES public.auth_users(id)
);

CREATE INDEX scenario_runs_prompt_created_at_idx ON public.scenario_runs (prompt_id, created_at DESC, id DESC);

CREATE INDEX scenario_runs_queue_idx ON public.scenario_runs (status, created_at, id);
