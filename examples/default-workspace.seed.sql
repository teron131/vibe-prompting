-- Imports the external captured workspace example into the current schema for the most recently active member.

DO $seed$
DECLARE
  actor_id uuid;
  fixture constant jsonb := current_setting('vibe_prompting.example_workspace_fixture')::jsonb;
  case_data jsonb;
  message_data jsonb;
  profile_data jsonb;
  resolved_criterion_id uuid;
  revision_data jsonb;
  run_data jsonb;
  score_data jsonb;
  turn_data jsonb;
BEGIN
  SELECT id
  INTO actor_id
  FROM auth_users
  WHERE membership_status = 'active'
  ORDER BY last_signed_in_at DESC, activated_at DESC NULLS LAST, created_at DESC, id
  LIMIT 1;

  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'Cannot seed the default workspace example without an active workspace member.';
  END IF;

  FOR revision_data IN SELECT value FROM jsonb_array_elements(fixture #> '{criteria,criterionSequence}')
  LOOP
    SELECT id
    INTO resolved_criterion_id
    FROM evaluation_criterion
    WHERE
      id = (revision_data->>'id')::uuid
      OR lower(btrim(name)) = lower(btrim(revision_data->>'name'))
    ORDER BY (lower(btrim(name)) = lower(btrim(revision_data->>'name'))) DESC
    LIMIT 1;

    IF resolved_criterion_id IS NULL THEN
      INSERT INTO evaluation_criterion (id, name, definition_json, created_by_user_id, updated_by_user_id)
      VALUES (
        (revision_data->>'id')::uuid,
        revision_data->>'name',
        revision_data->'definition',
        actor_id,
        actor_id
      );
    ELSE
      UPDATE evaluation_criterion
      SET
        name = revision_data->>'name',
        definition_json = revision_data->'definition',
        version = version + 1,
        updated_by_user_id = actor_id
      WHERE
        id = resolved_criterion_id
        AND (
          name IS DISTINCT FROM revision_data->>'name'
          OR definition_json IS DISTINCT FROM revision_data->'definition'
        );
    END IF;
  END LOOP;

  INSERT INTO evaluation_criteria (id, name, created_by_user_id, updated_by_user_id)
  VALUES (
    (fixture #>> '{criteria,id}')::uuid,
    fixture #>> '{criteria,name}',
    actor_id,
    actor_id
  )
  ON CONFLICT (id) DO UPDATE
  SET
    name = EXCLUDED.name,
    version = evaluation_criteria.version + 1,
    updated_by_user_id = EXCLUDED.updated_by_user_id
  WHERE evaluation_criteria.name IS DISTINCT FROM EXCLUDED.name;

  INSERT INTO evaluation_criteria_items (criteria_id, criterion_id, position)
  SELECT
    (fixture #>> '{criteria,id}')::uuid,
    evaluation_criterion.id,
    ordinality - 1
  FROM jsonb_array_elements(fixture #> '{criteria,criterionSequence}') WITH ORDINALITY AS criterion(item, ordinality)
  JOIN evaluation_criterion
    ON lower(btrim(evaluation_criterion.name)) = lower(btrim(item->>'name'))
  WHERE NOT EXISTS (
    SELECT 1
    FROM evaluation_criteria_items
    WHERE criteria_id = (fixture #>> '{criteria,id}')::uuid
  )
  ON CONFLICT (criteria_id, position) DO NOTHING;

  INSERT INTO prompts (id, title, active_revision_id, created_at, updated_at)
  VALUES (
    (fixture #>> '{prompt,id}')::uuid,
    fixture #>> '{prompt,title}',
    (fixture #>> '{prompt,activeRevisionId}')::uuid,
    (fixture #>> '{promptRows,0,createdAt}')::timestamptz,
    (fixture #>> '{prompt,updatedAt}')::timestamptz
  )
  ON CONFLICT (id) DO NOTHING;

  FOR revision_data IN SELECT value FROM jsonb_array_elements(fixture->'promptRows')
  LOOP
    INSERT INTO prompt_revisions (
      id, prompt_id, parent_revision_id, revision_number, markdown, change_request, author, created_at, created_by_user_id
    )
    VALUES (
      (revision_data->>'id')::uuid,
      (revision_data->>'promptId')::uuid,
      (revision_data->>'parentRevisionId')::uuid,
      (revision_data->>'revisionNumber')::integer,
      revision_data->>'markdown',
      revision_data->>'changeRequest',
      revision_data->>'author',
      (revision_data->>'createdAt')::timestamptz,
      actor_id
    )
    ON CONFLICT (id) DO NOTHING;
  END LOOP;

  profile_data := fixture #> '{targetProfileRows,0}';
  INSERT INTO target_profiles (id, name, prompt_id, current_revision_id)
  VALUES (
    (profile_data->>'id')::uuid,
    profile_data->>'name',
    (profile_data->>'promptId')::uuid,
    (profile_data->>'currentRevisionId')::uuid
  )
  ON CONFLICT (id) DO NOTHING;

  FOR revision_data IN SELECT value FROM jsonb_array_elements(fixture->'targetProfileRows')
  LOOP
    INSERT INTO target_profile_revisions (
      id, target_profile_id, parent_revision_id, revision_number, instructions, configuration, created_by_user_id
    )
    VALUES (
      (revision_data->>'revisionId')::uuid,
      (revision_data->>'id')::uuid,
      (revision_data->>'parentRevisionId')::uuid,
      (revision_data->>'revisionNumber')::integer,
      revision_data->>'instructions',
      revision_data->'configuration',
      actor_id
    )
    ON CONFLICT (id) DO NOTHING;
  END LOOP;

  INSERT INTO chats (
    id, owner_user_id, title, icon, model_id, workspace_context_json, created_at, updated_at
  )
  VALUES (
    (fixture #>> '{chat,chat,id}')::uuid,
    actor_id,
    fixture #>> '{chat,chat,title}',
    fixture #>> '{chat,chat,icon}',
    fixture #>> '{chat,chat,modelId}',
    fixture #> '{chat,context}',
    (fixture #>> '{chat,chat,createdAt}')::timestamptz,
    (fixture #>> '{chat,chat,updatedAt}')::timestamptz
  )
  ON CONFLICT (id) DO NOTHING;

  FOR message_data IN SELECT value FROM jsonb_array_elements(fixture #> '{chat,messages}')
  LOOP
    INSERT INTO chat_messages (
      id, chat_id, role, parts_json, metadata_json, text_content, created_at
    )
    VALUES (
      (message_data->>'id')::uuid,
      (message_data->>'chatId')::uuid,
      message_data->>'role',
      message_data->'parts',
      message_data->'metadata',
      COALESCE(
        (
          SELECT string_agg(part->>'text', E'\n' ORDER BY position)
          FROM jsonb_array_elements(message_data->'parts') WITH ORDINALITY AS parts(part, position)
          WHERE part->>'type' = 'text'
        ),
        ''
      ),
      (message_data->>'createdAt')::timestamptz
    )
    ON CONFLICT (id) DO NOTHING;
  END LOOP;

  FOR run_data IN SELECT value FROM jsonb_array_elements(fixture->'targetRuns')
  LOOP
    INSERT INTO target_runs (
      id, prompt_id, prompt_revision_id, target_profile_id, target_profile_revision_id, target_model_id,
      reasoning_effort, effective_instructions_hash, source, chat_id, started_by_user_id, created_at, updated_at
    )
    VALUES (
      (run_data->>'id')::uuid,
      (run_data->>'promptId')::uuid,
      (run_data->>'promptRevisionId')::uuid,
      (run_data->>'targetProfileId')::uuid,
      (run_data->>'targetProfileRevisionId')::uuid,
      run_data->>'targetModelId',
      run_data->>'reasoningEffort',
      run_data->>'effectiveInstructionsHash',
      run_data->>'source',
      (run_data->>'chatId')::uuid,
      actor_id,
      (run_data->>'createdAt')::timestamptz,
      (run_data->>'updatedAt')::timestamptz
    )
    ON CONFLICT (id) DO NOTHING;

    FOR turn_data IN SELECT value FROM jsonb_array_elements(run_data->'turns')
    LOOP
      INSERT INTO target_run_turns (
        id, run_id, position, input_text, output_text, response_messages_json, usage_json,
        activity_json, status, error_message, created_by_user_id, created_at, completed_at
      )
      VALUES (
        (turn_data->>'id')::uuid,
        (run_data->>'id')::uuid,
        (turn_data->>'position')::integer,
        turn_data->>'input',
        turn_data->>'output',
        COALESCE(
          (
            SELECT item->'responseMessages'
            FROM jsonb_array_elements(fixture->'targetTurnRows') AS rows(item)
            WHERE item->>'id' = turn_data->>'id'
          ),
          '[]'::jsonb
        ),
        turn_data->'usage',
        turn_data->'activity',
        turn_data->>'status',
        turn_data->>'errorMessage',
        actor_id,
        (turn_data->>'createdAt')::timestamptz,
        (turn_data->>'completedAt')::timestamptz
      )
      ON CONFLICT (id) DO NOTHING;
    END LOOP;
  END LOOP;

  FOR run_data IN SELECT value FROM jsonb_array_elements(fixture->'evaluations')
  LOOP
    INSERT INTO evaluation_runs (
      id, prompt_id, prompt_revision_id, chat_id, source, target_model_id, judge_model_ids,
      status, configuration_fingerprint, error_message, created_at, completed_at,
      is_synthetic_example, started_by_user_id, target_profile_id, target_profile_revision_id,
      effective_instructions_hash, target_run_id, target_run_turn_id
    )
    VALUES (
      (run_data->>'id')::uuid,
      (run_data->>'promptId')::uuid,
      (run_data->>'promptRevisionId')::uuid,
      (run_data->>'chatId')::uuid,
      run_data->>'source',
      run_data->>'targetModelId',
      ARRAY(SELECT jsonb_array_elements_text(run_data->'judgeModelIds')),
      run_data->>'status',
      run_data->>'configurationFingerprint',
      run_data->>'errorMessage',
      (run_data->>'createdAt')::timestamptz,
      (run_data->>'completedAt')::timestamptz,
      true,
      actor_id,
      (run_data->>'targetProfileId')::uuid,
      (run_data->>'targetProfileRevisionId')::uuid,
      run_data->>'effectiveInstructionsHash',
      (run_data->>'targetRunId')::uuid,
      (run_data->>'targetRunTurnId')::uuid
    )
    ON CONFLICT (id) DO NOTHING;

    FOR case_data IN SELECT value FROM jsonb_array_elements(run_data->'cases')
    LOOP
      INSERT INTO evaluation_cases (id, run_id, position, input_json, criteria_json, output_json)
      VALUES (
        (case_data->>'id')::uuid,
        (run_data->>'id')::uuid,
        (case_data->>'position')::integer,
        case_data->'input',
        case_data->'criteria',
        case_data->'output'
      )
      ON CONFLICT (id) DO NOTHING;

      FOR score_data IN SELECT value FROM jsonb_array_elements(case_data->'scores')
      LOOP
        INSERT INTO evaluation_scores (
          id, case_id, criterion_position, data_type, criterion_json, judge_model_id,
          value_json, comment, evidence_json
        )
        VALUES (
          (score_data->>'id')::uuid,
          (case_data->>'id')::uuid,
          (score_data->>'criterionPosition')::integer,
          score_data->>'dataType',
          score_data->'criterion',
          score_data->>'judgeModelId',
          score_data->'value',
          score_data->>'comment',
          score_data->'evidence'
        )
        ON CONFLICT (id) DO NOTHING;
      END LOOP;
    END LOOP;
  END LOOP;
END
$seed$;
