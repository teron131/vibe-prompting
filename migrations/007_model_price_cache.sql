-- Persists the latest known weighted OpenRouter price for each configured model ID.

CREATE TABLE public.model_price_cache (
    model_id text PRIMARY KEY,
    catalog_id text NOT NULL,
    permaslug text NOT NULL,
    input_price_per_million_tokens double precision NOT NULL,
    output_price_per_million_tokens double precision NOT NULL,
    fetched_at timestamp with time zone NOT NULL,
    CONSTRAINT model_price_cache_model_id_check CHECK ((btrim(model_id) <> ''::text)),
    CONSTRAINT model_price_cache_catalog_id_check CHECK ((btrim(catalog_id) <> ''::text)),
    CONSTRAINT model_price_cache_permaslug_check CHECK ((btrim(permaslug) <> ''::text)),
    CONSTRAINT model_price_cache_input_price_check CHECK ((input_price_per_million_tokens >= (0)::double precision)),
    CONSTRAINT model_price_cache_output_price_check CHECK ((output_price_per_million_tokens >= (0)::double precision))
);
