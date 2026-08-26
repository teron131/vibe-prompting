-- Migrates persisted Criteria profiles into reusable named Criterion resources after the schema baseline changed in place.

CREATE TABLE IF NOT EXISTS public.evaluation_criterion (
    id uuid PRIMARY KEY,
    name text NOT NULL,
    definition_json jsonb NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    created_by_user_id uuid NOT NULL,
    updated_by_user_id uuid NOT NULL,
    CONSTRAINT evaluation_criterion_definition_json_check CHECK ((jsonb_typeof(definition_json) = 'object'::text)),
    CONSTRAINT evaluation_criterion_name_check CHECK ((btrim(name) <> ''::text)),
    CONSTRAINT evaluation_criterion_version_check CHECK ((version > 0)),
    CONSTRAINT evaluation_criterion_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.auth_users(id),
    CONSTRAINT evaluation_criterion_updated_by_user_id_fkey FOREIGN KEY (updated_by_user_id) REFERENCES public.auth_users(id)
);

CREATE TABLE IF NOT EXISTS public.evaluation_criteria (
    id uuid PRIMARY KEY,
    name text NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    created_by_user_id uuid NOT NULL,
    updated_by_user_id uuid NOT NULL,
    CONSTRAINT evaluation_criteria_name_check CHECK ((btrim(name) <> ''::text)),
    CONSTRAINT evaluation_criteria_version_check CHECK ((version > 0)),
    CONSTRAINT evaluation_criteria_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.auth_users(id),
    CONSTRAINT evaluation_criteria_updated_by_user_id_fkey FOREIGN KEY (updated_by_user_id) REFERENCES public.auth_users(id)
);

CREATE TABLE IF NOT EXISTS public.evaluation_criteria_items (
    criteria_id uuid NOT NULL,
    criterion_id uuid NOT NULL,
    "position" integer NOT NULL,
    CONSTRAINT evaluation_criteria_items_pkey PRIMARY KEY (criteria_id, "position"),
    CONSTRAINT evaluation_criteria_items_criterion_key UNIQUE (criteria_id, criterion_id),
    CONSTRAINT evaluation_criteria_items_position_check CHECK (("position" >= 0)),
    CONSTRAINT evaluation_criteria_items_criteria_id_fkey FOREIGN KEY (criteria_id) REFERENCES public.evaluation_criteria(id) ON DELETE CASCADE,
    CONSTRAINT evaluation_criteria_items_criterion_id_fkey FOREIGN KEY (criterion_id) REFERENCES public.evaluation_criterion(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS evaluation_criterion_name_idx ON public.evaluation_criterion USING btree (lower(btrim(name)));

CREATE UNIQUE INDEX IF NOT EXISTS evaluation_criteria_name_idx ON public.evaluation_criteria USING btree (lower(btrim(name)));

DO $$
BEGIN
    IF to_regclass('public.evaluation_criteria_profiles') IS NULL THEN
        RETURN;
    END IF;

    CREATE TEMPORARY TABLE named_criteria_migration ON COMMIT DROP AS
    WITH expanded AS (
        SELECT
            profile.id AS criteria_id,
            profile.name AS criteria_name,
            profile.version AS criteria_version,
            profile.created_by_user_id,
            profile.updated_by_user_id,
            item.definition,
            (item.position - 1)::integer AS criterion_position
        FROM public.evaluation_criteria_profiles AS profile
        CROSS JOIN LATERAL jsonb_array_elements(profile.criteria_json)
            WITH ORDINALITY AS item(definition, position)
    ),
    named AS (
        SELECT
            *,
            COALESCE(
                NULLIF(btrim(definition ->> 'name'), ''),
                left(criteria_name, 96) || ' · Criterion ' || (criterion_position + 1)
            ) AS base_name
        FROM expanded
    ),
    counted AS (
        SELECT
            *,
            count(*) OVER (
                PARTITION BY lower(btrim(base_name))
            ) AS shared_name_count
        FROM named
    )
    SELECT
        criteria_id,
        criteria_name,
        criteria_version,
        created_by_user_id,
        updated_by_user_id,
        gen_random_uuid() AS criterion_id,
        CASE
            WHEN shared_name_count = 1 THEN left(base_name, 120)
            ELSE left(base_name, 80) || ' (' || left(criteria_name, 25) || ' ' || left(criteria_id::text, 8) || ')'
        END AS criterion_name,
        definition - 'name' AS criterion_definition,
        criterion_position
    FROM counted;

    INSERT INTO public.evaluation_criterion (
        id,
        name,
        definition_json,
        version,
        created_by_user_id,
        updated_by_user_id
    )
    SELECT
        criterion_id,
        criterion_name,
        criterion_definition,
        1,
        created_by_user_id,
        updated_by_user_id
    FROM named_criteria_migration;

    INSERT INTO public.evaluation_criteria (
        id,
        name,
        version,
        created_by_user_id,
        updated_by_user_id
    )
    SELECT
        id,
        name,
        version,
        created_by_user_id,
        updated_by_user_id
    FROM public.evaluation_criteria_profiles;

    INSERT INTO public.evaluation_criteria_items (criteria_id, criterion_id, "position")
    SELECT criteria_id, criterion_id, criterion_position
    FROM named_criteria_migration;

    DROP TABLE public.evaluation_criteria_profiles;
END
$$;
