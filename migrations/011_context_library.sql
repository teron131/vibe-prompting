-- Renames the shared document domain while preserving IDs, revision content, execution hashes, and recorded conversations.

ALTER TABLE prompts RENAME TO contexts;
ALTER TABLE prompt_revisions RENAME TO context_revisions;
ALTER TABLE context_revisions RENAME COLUMN prompt_id TO context_id;
ALTER TABLE target_profiles RENAME COLUMN prompt_id TO context_id;
ALTER TABLE target_runs RENAME COLUMN prompt_id TO context_id;
ALTER TABLE target_runs RENAME COLUMN prompt_revision_id TO context_revision_id;
ALTER TABLE evaluation_runs RENAME COLUMN prompt_id TO context_id;
ALTER TABLE evaluation_runs RENAME COLUMN prompt_revision_id TO context_revision_id;
ALTER TABLE scenario_runs RENAME COLUMN prompt_id TO context_id;
ALTER TABLE scenario_runs RENAME COLUMN prompt_revision_id TO context_revision_id;

-- PostgreSQL keeps foreign-key references intact when tables and columns are renamed.
DO $rename$
DECLARE
  entry record;
BEGIN
  FOR entry IN
    SELECT conrelid::regclass AS relation, conname
    FROM pg_constraint
    WHERE connamespace = 'public'::regnamespace AND conname LIKE '%prompt%'
  LOOP
    EXECUTE format('ALTER TABLE %s RENAME CONSTRAINT %I TO %I', entry.relation, entry.conname, replace(entry.conname, 'prompt', 'context'));
  END LOOP;
  FOR entry IN
    SELECT indexrelid::regclass AS relation, relname
    FROM pg_index JOIN pg_class ON pg_class.oid = indexrelid
    WHERE relnamespace = 'public'::regnamespace AND relname LIKE '%prompt%'
  LOOP
    EXECUTE format('ALTER INDEX %s RENAME TO %I', entry.relation, replace(entry.relname, 'prompt', 'context'));
  END LOOP;
END
$rename$;

UPDATE search_embeddings SET target = 'context' WHERE target = 'prompt';

-- Transform application references only; Markdown, user text, summaries, and provider messages remain unchanged.
CREATE FUNCTION pg_temp.context_references(value jsonb, field text DEFAULT '') RETURNS jsonb
LANGUAGE plpgsql AS $references$
DECLARE
  result jsonb;
  entry record;
  key text;
  label text;
BEGIN
  IF jsonb_typeof(value) = 'object' THEN
    result := '{}'::jsonb;
    FOR entry IN SELECT * FROM jsonb_each(value)
    LOOP
      key := CASE entry.key
        WHEN 'prompt' THEN 'context'
        WHEN 'prompts' THEN 'contexts'
        WHEN 'promptId' THEN 'contextId'
        WHEN 'promptRevisionId' THEN 'contextRevisionId'
        WHEN 'promptRevisionNumber' THEN 'contextRevisionNumber'
        WHEN 'promptTitle' THEN 'contextTitle'
        WHEN 'promptMarkdown' THEN 'contextMarkdown'
        WHEN 'activePromptId' THEN 'activeContextId'
        WHEN 'activePromptRevisionId' THEN 'activeContextRevisionId'
        ELSE entry.key
      END;
      result := result || jsonb_build_object(key, CASE
        WHEN entry.key IN ('input', 'output') AND coalesce(value->>'type', '') <> 'tool' THEN entry.value
        WHEN entry.key IN ('metadata', 'expectedOutput', 'evidence') THEN entry.value
        ELSE pg_temp.context_references(entry.value, key)
      END);
    END LOOP;
    RETURN result;
  END IF;
  IF jsonb_typeof(value) = 'array' THEN
    SELECT coalesce(jsonb_agg(pg_temp.context_references(item, field) ORDER BY position), '[]'::jsonb)
    INTO result FROM jsonb_array_elements(value) WITH ORDINALITY AS elements(item, position);
    RETURN result;
  END IF;
  IF jsonb_typeof(value) = 'string' THEN
    label := value #>> '{}';
    IF field IN ('type', 'kind', 'name', 'enabledTools') THEN
      label := CASE label
        WHEN 'prompt' THEN 'context'
        WHEN 'prompt-library' THEN 'context-library'
        WHEN 'prompt-revision' THEN 'context-revision'
        WHEN 'prompt-quote' THEN 'context-quote'
        WHEN 'list_prompts' THEN 'list_contexts'
        WHEN 'read_prompt' THEN 'read_context'
        WHEN 'search_prompts' THEN 'search_contexts'
        WHEN 'create_prompt' THEN 'create_context'
        WHEN 'edit_prompt' THEN 'edit_context'
        ELSE label
      END;
    ELSIF field = 'href' AND label LIKE '/%' THEN
      label := regexp_replace(label, '^/prompts', '/contexts');
      label := regexp_replace(label, '([?&])prompt(Id|RevisionId)?=', '\1context\2=', 'g');
    END IF;
    RETURN to_jsonb(label);
  END IF;
  RETURN value;
END
$references$;

UPDATE chats SET workspace_context_json = pg_temp.context_references(workspace_context_json);
UPDATE chat_messages SET parts_json = pg_temp.context_references(parts_json), metadata_json = pg_temp.context_references(metadata_json);
UPDATE target_run_turns SET activity_json = pg_temp.context_references(activity_json);
DROP FUNCTION pg_temp.context_references(jsonb, text);
