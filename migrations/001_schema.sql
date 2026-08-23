-- Defines the complete PostgreSQL schema for a rebuilt Vibe Prompting workspace.

CREATE TABLE public.application_settings (
    singleton boolean DEFAULT true NOT NULL,
    model_catalog jsonb NOT NULL,
    provider_overrides jsonb DEFAULT '{}'::jsonb NOT NULL,
    helper_model jsonb,
    revision integer DEFAULT 1 NOT NULL,
    updated_by_user_id uuid,
    CONSTRAINT application_settings_revision_check CHECK ((revision > 0)),
    CONSTRAINT application_settings_singleton_check CHECK (singleton)
);

CREATE TABLE public.auth_sessions (
    token_hash text NOT NULL,
    user_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    CONSTRAINT auth_sessions_token_hash_check CHECK ((length(token_hash) = 64))
);

CREATE TABLE public.auth_users (
    id uuid NOT NULL,
    google_subject text NOT NULL,
    email text NOT NULL,
    name text,
    membership_status text DEFAULT 'pending'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_signed_in_at timestamp with time zone DEFAULT now() NOT NULL,
    activated_at timestamp with time zone,
    invitation_attempt_count integer DEFAULT 0 NOT NULL,
    invitation_locked_until timestamp with time zone,
    CONSTRAINT auth_users_invitation_attempt_count_check CHECK ((invitation_attempt_count >= 0)),
    CONSTRAINT auth_users_membership_status_check CHECK ((membership_status = ANY (ARRAY['pending'::text, 'active'::text])))
);

CREATE TABLE public.chat_messages (
    id uuid NOT NULL,
    chat_id uuid NOT NULL,
    role text NOT NULL,
    parts_json jsonb NOT NULL,
    metadata_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    text_content text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chat_messages_role_check CHECK ((role = ANY (ARRAY['user'::text, 'assistant'::text])))
);

CREATE TABLE public.chat_usage_events (
    accepted_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.chats (
    id uuid NOT NULL,
    title text NOT NULL,
    icon text DEFAULT 'message-circle'::text NOT NULL,
    model_id text NOT NULL,
    workspace_context_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    owner_user_id uuid NOT NULL,
    CONSTRAINT chats_model_id_check CHECK ((btrim(model_id) <> ''::text)),
    CONSTRAINT chats_title_check CHECK ((btrim(title) <> ''::text))
);

CREATE TABLE public.evaluation_cases (
    id uuid NOT NULL,
    run_id uuid NOT NULL,
    "position" integer NOT NULL,
    input_json jsonb NOT NULL,
    criteria_json jsonb NOT NULL,
    output_json jsonb,
    CONSTRAINT evaluation_cases_position_check CHECK (("position" >= 0))
);

CREATE TABLE public.evaluation_criteria_profiles (
    id uuid NOT NULL,
    name text NOT NULL,
    criteria_json jsonb NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    created_by_user_id uuid NOT NULL,
    updated_by_user_id uuid NOT NULL,
    CONSTRAINT evaluation_criteria_profiles_criteria_json_check CHECK (((jsonb_typeof(criteria_json) = 'array'::text) AND (jsonb_array_length(criteria_json) > 0))),
    CONSTRAINT evaluation_criteria_profiles_name_check CHECK ((btrim(name) <> ''::text)),
    CONSTRAINT evaluation_criteria_profiles_version_check CHECK ((version > 0))
);

CREATE TABLE public.evaluation_runs (
    id uuid NOT NULL,
    prompt_id uuid NOT NULL,
    prompt_revision_id uuid NOT NULL,
    chat_id uuid,
    source text NOT NULL,
    target_model_id text NOT NULL,
    judge_model_ids text[] NOT NULL,
    status text NOT NULL,
    configuration_fingerprint text NOT NULL,
    error_message text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    target_profile_id uuid,
    target_profile_revision_id uuid,
    effective_instructions_hash text,
    is_synthetic_example boolean DEFAULT false NOT NULL,
    target_run_id uuid,
    target_run_turn_id uuid,
    started_by_user_id uuid NOT NULL,
    cancelled_at timestamp with time zone,
    cancelled_by_user_id uuid,
    CONSTRAINT evaluation_runs_cancellation CHECK ((((status = 'cancelled'::text) AND (cancelled_at IS NOT NULL) AND (cancelled_by_user_id IS NOT NULL)) OR ((status <> 'cancelled'::text) AND (cancelled_at IS NULL) AND (cancelled_by_user_id IS NULL)))),
    CONSTRAINT evaluation_runs_configuration_fingerprint_check CHECK ((btrim(configuration_fingerprint) <> ''::text)),
    CONSTRAINT evaluation_runs_judge_model_ids_check CHECK ((cardinality(judge_model_ids) > 0)),
    CONSTRAINT evaluation_runs_source_check CHECK ((source = ANY (ARRAY['human'::text, 'ai'::text]))),
    CONSTRAINT evaluation_runs_status_check CHECK ((status = ANY (ARRAY['queued'::text, 'running'::text, 'completed'::text, 'failed'::text, 'cancelled'::text, 'interrupted'::text]))),
    CONSTRAINT evaluation_runs_target_model_id_check CHECK ((btrim(target_model_id) <> ''::text)),
    CONSTRAINT evaluation_runs_target_provenance CHECK ((((target_profile_id IS NULL) AND (target_profile_revision_id IS NULL) AND (effective_instructions_hash IS NULL)) OR ((target_profile_id IS NOT NULL) AND (target_profile_revision_id IS NOT NULL) AND (btrim(effective_instructions_hash) <> ''::text)))),
    CONSTRAINT evaluation_runs_target_trace_source CHECK ((((target_run_id IS NULL) AND (target_run_turn_id IS NULL)) OR ((target_run_id IS NOT NULL) AND (target_run_turn_id IS NOT NULL))))
);

CREATE TABLE public.evaluation_scores (
    id uuid NOT NULL,
    case_id uuid NOT NULL,
    criterion_position integer NOT NULL,
    data_type text NOT NULL,
    criterion_json jsonb NOT NULL,
    judge_model_id text NOT NULL,
    value_json jsonb NOT NULL,
    comment text NOT NULL,
    evidence_json jsonb NOT NULL,
    CONSTRAINT evaluation_scores_criterion_position_check CHECK ((criterion_position >= 0)),
    CONSTRAINT evaluation_scores_data_type_check CHECK ((data_type = ANY (ARRAY['BOOLEAN'::text, 'CATEGORICAL'::text, 'CORRECTION'::text, 'NUMERIC'::text, 'TEXT'::text]))),
    CONSTRAINT evaluation_scores_judge_model_id_check CHECK ((btrim(judge_model_id) <> ''::text))
);

CREATE TABLE public.model_cost_events (
    id bigint NOT NULL,
    model_id text NOT NULL,
    input_tokens bigint NOT NULL,
    output_tokens bigint NOT NULL,
    estimated_cost_usd numeric(12,6) NOT NULL,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT model_cost_events_estimated_cost_usd_check CHECK ((estimated_cost_usd >= (0)::numeric)),
    CONSTRAINT model_cost_events_input_tokens_check CHECK ((input_tokens >= 0)),
    CONSTRAINT model_cost_events_output_tokens_check CHECK ((output_tokens >= 0))
);

ALTER TABLE public.model_cost_events ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.model_cost_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE public.prompt_revisions (
    id uuid NOT NULL,
    prompt_id uuid NOT NULL,
    parent_revision_id uuid,
    revision_number integer NOT NULL,
    markdown text NOT NULL,
    change_request text,
    author text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by_user_id uuid NOT NULL,
    CONSTRAINT prompt_revisions_author_check CHECK ((author = ANY (ARRAY['human'::text, 'ai'::text]))),
    CONSTRAINT prompt_revisions_revision_number_check CHECK ((revision_number > 0))
);

CREATE TABLE public.prompts (
    id uuid NOT NULL,
    title text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    active_revision_id uuid NOT NULL,
    CONSTRAINT prompts_title_check CHECK ((btrim(title) <> ''::text))
);

CREATE TABLE public.search_embeddings (
    target text NOT NULL,
    document_id text NOT NULL,
    owner_id uuid NOT NULL,
    content_hash text NOT NULL,
    model text NOT NULL,
    embedding jsonb NOT NULL,
    CONSTRAINT search_embeddings_document_id_check CHECK ((btrim(document_id) <> ''::text)),
    CONSTRAINT search_embeddings_embedding_check CHECK ((jsonb_typeof(embedding) = 'array'::text)),
    CONSTRAINT search_embeddings_target_check CHECK ((btrim(target) <> ''::text))
);

CREATE TABLE public.target_profile_revisions (
    id uuid NOT NULL,
    target_profile_id uuid NOT NULL,
    parent_revision_id uuid,
    revision_number integer NOT NULL,
    instructions text NOT NULL,
    configuration jsonb NOT NULL,
    created_by_user_id uuid NOT NULL,
    CONSTRAINT target_profile_revisions_configuration_check CHECK ((jsonb_typeof(configuration) = 'object'::text)),
    CONSTRAINT target_profile_revisions_revision_number_check CHECK ((revision_number > 0))
);

CREATE TABLE public.target_profiles (
    id uuid NOT NULL,
    name text NOT NULL,
    prompt_id uuid NOT NULL,
    current_revision_id uuid NOT NULL,
    CONSTRAINT target_profiles_name_check CHECK ((btrim(name) <> ''::text))
);

CREATE TABLE public.target_run_turns (
    id uuid NOT NULL,
    run_id uuid NOT NULL,
    "position" integer NOT NULL,
    input_text text NOT NULL,
    output_text text,
    response_messages_json jsonb,
    usage_json jsonb,
    status text NOT NULL,
    error_message text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    activity_json jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_by_user_id uuid NOT NULL,
    cancelled_at timestamp with time zone,
    cancelled_by_user_id uuid,
    CONSTRAINT target_run_turns_cancellation CHECK ((((status = 'cancelled'::text) AND (cancelled_at IS NOT NULL) AND (cancelled_by_user_id IS NOT NULL)) OR ((status <> 'cancelled'::text) AND (cancelled_at IS NULL) AND (cancelled_by_user_id IS NULL)))),
    CONSTRAINT target_run_turns_input_text_check CHECK ((btrim(input_text) <> ''::text)),
    CONSTRAINT target_run_turns_position_check CHECK (("position" >= 0)),
    CONSTRAINT target_run_turns_status_check CHECK ((status = ANY (ARRAY['running'::text, 'completed'::text, 'failed'::text, 'cancelled'::text, 'interrupted'::text])))
);

CREATE TABLE public.target_runs (
    id uuid NOT NULL,
    prompt_id uuid NOT NULL,
    prompt_revision_id uuid NOT NULL,
    target_profile_id uuid NOT NULL,
    target_profile_revision_id uuid NOT NULL,
    target_model_id text NOT NULL,
    effective_instructions_hash text NOT NULL,
    source text NOT NULL,
    chat_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    reasoning_effort text DEFAULT 'medium'::text NOT NULL,
    started_by_user_id uuid NOT NULL,
    CONSTRAINT target_runs_effective_instructions_hash_check CHECK ((btrim(effective_instructions_hash) <> ''::text)),
    CONSTRAINT target_runs_reasoning_effort_check CHECK ((reasoning_effort = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text, 'xhigh'::text]))),
    CONSTRAINT target_runs_source_check CHECK ((source = ANY (ARRAY['human'::text, 'ai'::text]))),
    CONSTRAINT target_runs_target_model_id_check CHECK ((btrim(target_model_id) <> ''::text))
);

ALTER TABLE ONLY public.application_settings
    ADD CONSTRAINT application_settings_pkey PRIMARY KEY (singleton);

ALTER TABLE ONLY public.auth_sessions
    ADD CONSTRAINT auth_sessions_pkey PRIMARY KEY (token_hash);

ALTER TABLE ONLY public.auth_users
    ADD CONSTRAINT auth_users_google_subject_key UNIQUE (google_subject);

ALTER TABLE ONLY public.auth_users
    ADD CONSTRAINT auth_users_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT chat_messages_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.chats
    ADD CONSTRAINT chats_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.evaluation_cases
    ADD CONSTRAINT evaluation_cases_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.evaluation_cases
    ADD CONSTRAINT evaluation_cases_run_id_position_key UNIQUE (run_id, "position");

ALTER TABLE ONLY public.evaluation_criteria_profiles
    ADD CONSTRAINT evaluation_criteria_profiles_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.evaluation_runs
    ADD CONSTRAINT evaluation_runs_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.evaluation_scores
    ADD CONSTRAINT evaluation_scores_case_id_criterion_position_judge_model_id_key UNIQUE (case_id, criterion_position, judge_model_id);

ALTER TABLE ONLY public.evaluation_scores
    ADD CONSTRAINT evaluation_scores_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.model_cost_events
    ADD CONSTRAINT model_cost_events_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.prompt_revisions
    ADD CONSTRAINT prompt_revisions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.prompt_revisions
    ADD CONSTRAINT prompt_revisions_prompt_id_id_key UNIQUE (prompt_id, id);

ALTER TABLE ONLY public.prompt_revisions
    ADD CONSTRAINT prompt_revisions_prompt_id_revision_number_key UNIQUE (prompt_id, revision_number);

ALTER TABLE ONLY public.prompts
    ADD CONSTRAINT prompts_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.search_embeddings
    ADD CONSTRAINT search_embeddings_pkey PRIMARY KEY (target, document_id);

ALTER TABLE ONLY public.target_profile_revisions
    ADD CONSTRAINT target_profile_revisions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.target_profile_revisions
    ADD CONSTRAINT target_profile_revisions_target_profile_id_id_key UNIQUE (target_profile_id, id);

ALTER TABLE ONLY public.target_profile_revisions
    ADD CONSTRAINT target_profile_revisions_target_profile_id_revision_number_key UNIQUE (target_profile_id, revision_number);

ALTER TABLE ONLY public.target_profiles
    ADD CONSTRAINT target_profiles_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.target_profiles
    ADD CONSTRAINT target_profiles_prompt_id_key UNIQUE (prompt_id);

ALTER TABLE ONLY public.target_run_turns
    ADD CONSTRAINT target_run_turns_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.target_run_turns
    ADD CONSTRAINT target_run_turns_run_id_position_key UNIQUE (run_id, "position");

ALTER TABLE ONLY public.target_runs
    ADD CONSTRAINT target_runs_pkey PRIMARY KEY (id);

CREATE INDEX auth_sessions_expires_at_idx ON public.auth_sessions USING btree (expires_at);

CREATE INDEX auth_sessions_user_id_idx ON public.auth_sessions USING btree (user_id);

CREATE INDEX chat_messages_chat_created_at_idx ON public.chat_messages USING btree (chat_id, created_at, id);

CREATE INDEX chat_usage_events_accepted_at_idx ON public.chat_usage_events USING btree (accepted_at);

CREATE INDEX chats_owner_updated_at_idx ON public.chats USING btree (owner_user_id, updated_at DESC, id DESC);

CREATE UNIQUE INDEX evaluation_criteria_profiles_name_idx ON public.evaluation_criteria_profiles USING btree (lower(btrim(name)));

CREATE INDEX evaluation_runs_fingerprint_idx ON public.evaluation_runs USING btree (prompt_id, configuration_fingerprint, status, completed_at, id);

CREATE INDEX evaluation_runs_prompt_created_at_idx ON public.evaluation_runs USING btree (prompt_id, created_at DESC, id DESC);

CREATE INDEX evaluation_runs_queue_idx ON public.evaluation_runs USING btree (status, created_at, id);

CREATE INDEX evaluation_runs_started_by_user_id_idx ON public.evaluation_runs USING btree (started_by_user_id);

CREATE INDEX evaluation_runs_workspace_created_at_idx ON public.evaluation_runs USING btree (created_at DESC, id DESC);

CREATE INDEX evaluation_runs_workspace_filter_idx ON public.evaluation_runs USING btree (prompt_id, prompt_revision_id, target_model_id, status, created_at DESC, id DESC);

CREATE INDEX evaluation_scores_workspace_filter_idx ON public.evaluation_scores USING btree (judge_model_id, data_type, case_id);

CREATE INDEX model_cost_events_window_idx ON public.model_cost_events USING btree (recorded_at, id);

CREATE INDEX prompt_revisions_created_by_user_id_idx ON public.prompt_revisions USING btree (created_by_user_id);

CREATE INDEX target_profile_revisions_created_by_user_id_idx ON public.target_profile_revisions USING btree (created_by_user_id);

CREATE INDEX target_run_turns_created_by_user_id_idx ON public.target_run_turns USING btree (created_by_user_id);

CREATE UNIQUE INDEX target_run_turns_one_running_idx ON public.target_run_turns USING btree (run_id) WHERE (status = 'running'::text);

CREATE INDEX target_runs_prompt_updated_at_idx ON public.target_runs USING btree (prompt_id, updated_at DESC, id DESC);

CREATE INDEX target_runs_started_by_user_id_idx ON public.target_runs USING btree (started_by_user_id);

ALTER TABLE ONLY public.application_settings
    ADD CONSTRAINT application_settings_updated_by_user_id_fkey FOREIGN KEY (updated_by_user_id) REFERENCES public.auth_users(id);

ALTER TABLE ONLY public.auth_sessions
    ADD CONSTRAINT auth_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.auth_users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT chat_messages_chat_id_fkey FOREIGN KEY (chat_id) REFERENCES public.chats(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.chats
    ADD CONSTRAINT chats_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES public.auth_users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.evaluation_cases
    ADD CONSTRAINT evaluation_cases_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.evaluation_runs(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.evaluation_criteria_profiles
    ADD CONSTRAINT evaluation_criteria_profiles_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.auth_users(id);

ALTER TABLE ONLY public.evaluation_criteria_profiles
    ADD CONSTRAINT evaluation_criteria_profiles_updated_by_user_id_fkey FOREIGN KEY (updated_by_user_id) REFERENCES public.auth_users(id);

ALTER TABLE ONLY public.evaluation_runs
    ADD CONSTRAINT evaluation_runs_cancelled_by_user_id_fkey FOREIGN KEY (cancelled_by_user_id) REFERENCES public.auth_users(id);

ALTER TABLE ONLY public.evaluation_runs
    ADD CONSTRAINT evaluation_runs_chat_id_fkey FOREIGN KEY (chat_id) REFERENCES public.chats(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.evaluation_runs
    ADD CONSTRAINT evaluation_runs_prompt_id_fkey FOREIGN KEY (prompt_id) REFERENCES public.prompts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.evaluation_runs
    ADD CONSTRAINT evaluation_runs_prompt_id_prompt_revision_id_fkey FOREIGN KEY (prompt_id, prompt_revision_id) REFERENCES public.prompt_revisions(prompt_id, id) ON DELETE CASCADE;

ALTER TABLE ONLY public.evaluation_runs
    ADD CONSTRAINT evaluation_runs_started_by_user_id_fkey FOREIGN KEY (started_by_user_id) REFERENCES public.auth_users(id);

ALTER TABLE ONLY public.evaluation_runs
    ADD CONSTRAINT evaluation_runs_target_profile_id_fkey FOREIGN KEY (target_profile_id) REFERENCES public.target_profiles(id);

ALTER TABLE ONLY public.evaluation_runs
    ADD CONSTRAINT evaluation_runs_target_profile_revision FOREIGN KEY (target_profile_id, target_profile_revision_id) REFERENCES public.target_profile_revisions(target_profile_id, id);

ALTER TABLE ONLY public.evaluation_runs
    ADD CONSTRAINT evaluation_runs_target_run_id_fkey FOREIGN KEY (target_run_id) REFERENCES public.target_runs(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.evaluation_runs
    ADD CONSTRAINT evaluation_runs_target_run_turn_id_fkey FOREIGN KEY (target_run_turn_id) REFERENCES public.target_run_turns(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.evaluation_scores
    ADD CONSTRAINT evaluation_scores_case_id_fkey FOREIGN KEY (case_id) REFERENCES public.evaluation_cases(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.prompt_revisions
    ADD CONSTRAINT prompt_revisions_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.auth_users(id);

ALTER TABLE ONLY public.prompt_revisions
    ADD CONSTRAINT prompt_revisions_prompt_id_fkey FOREIGN KEY (prompt_id) REFERENCES public.prompts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.prompt_revisions
    ADD CONSTRAINT prompt_revisions_prompt_id_parent_revision_id_fkey FOREIGN KEY (prompt_id, parent_revision_id) REFERENCES public.prompt_revisions(prompt_id, id) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE ONLY public.prompts
    ADD CONSTRAINT prompts_active_revision FOREIGN KEY (id, active_revision_id) REFERENCES public.prompt_revisions(prompt_id, id) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE ONLY public.target_profile_revisions
    ADD CONSTRAINT target_profile_revisions_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.auth_users(id);

ALTER TABLE ONLY public.target_profile_revisions
    ADD CONSTRAINT target_profile_revisions_target_profile_id_fkey FOREIGN KEY (target_profile_id) REFERENCES public.target_profiles(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.target_profile_revisions
    ADD CONSTRAINT target_profile_revisions_target_profile_id_parent_revision_fkey FOREIGN KEY (target_profile_id, parent_revision_id) REFERENCES public.target_profile_revisions(target_profile_id, id) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE ONLY public.target_profiles
    ADD CONSTRAINT target_profiles_current_revision FOREIGN KEY (id, current_revision_id) REFERENCES public.target_profile_revisions(target_profile_id, id) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE ONLY public.target_profiles
    ADD CONSTRAINT target_profiles_prompt_id_fkey FOREIGN KEY (prompt_id) REFERENCES public.prompts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.target_run_turns
    ADD CONSTRAINT target_run_turns_cancelled_by_user_id_fkey FOREIGN KEY (cancelled_by_user_id) REFERENCES public.auth_users(id);

ALTER TABLE ONLY public.target_run_turns
    ADD CONSTRAINT target_run_turns_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.auth_users(id);

ALTER TABLE ONLY public.target_run_turns
    ADD CONSTRAINT target_run_turns_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.target_runs(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.target_runs
    ADD CONSTRAINT target_runs_chat_id_fkey FOREIGN KEY (chat_id) REFERENCES public.chats(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.target_runs
    ADD CONSTRAINT target_runs_prompt_id_fkey FOREIGN KEY (prompt_id) REFERENCES public.prompts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.target_runs
    ADD CONSTRAINT target_runs_prompt_id_prompt_revision_id_fkey FOREIGN KEY (prompt_id, prompt_revision_id) REFERENCES public.prompt_revisions(prompt_id, id);

ALTER TABLE ONLY public.target_runs
    ADD CONSTRAINT target_runs_started_by_user_id_fkey FOREIGN KEY (started_by_user_id) REFERENCES public.auth_users(id);

ALTER TABLE ONLY public.target_runs
    ADD CONSTRAINT target_runs_target_profile_id_fkey FOREIGN KEY (target_profile_id) REFERENCES public.target_profiles(id);

ALTER TABLE ONLY public.target_runs
    ADD CONSTRAINT target_runs_target_profile_id_target_profile_revision_id_fkey FOREIGN KEY (target_profile_id, target_profile_revision_id) REFERENCES public.target_profile_revisions(target_profile_id, id);
