/** Owns versioned text prompts, immutable revisions, an active product revision, and an independent editor history cursor. */

import { randomUUID } from "node:crypto";

import type { Database, DatabaseClient } from "../database.ts";
import type { HybridSearch } from "../search.ts";
import {
  createPromptSearch,
  type PromptPassageHit,
  type PromptSearch,
  type StoredPromptSearchResult,
} from "./search.ts";

export type PromptRevisionAuthor = "ai" | "human";

export type StoredPrompt = {
  activeRevisionId: string;
  activeRevisionNumber: number;
  canRedo: boolean;
  canUndo: boolean;
  markdown: string;
  createdAt: string;
  id: string;
  revisionCount: number;
  revisionId: string;
  revisionNumber: number;
  title: string;
  updatedAt: string;
};

export type StoredPromptRevisionSummary = {
  promptId: string;
  source: PromptRevisionAuthor;
  changeRequest: string | null;
  createdAt: string;
  id: string;
  parentRevisionId: string | null;
};

export type StoredPromptRevision = StoredPromptRevisionSummary & { markdown: string };

export type AiEditInput = {
  promptId: string;
  editedMarkdown: string;
  expectedRevisionId: string;
  instruction: string;
  visibleMarkdown: string;
};

type PromptRow = {
  activeRevisionId: string;
  activeRevisionNumber: number;
  canRedo: boolean;
  canUndo: boolean;
  markdown: string;
  createdAt: Date;
  id: string;
  revisionCount: number;
  revisionId: string;
  revisionNumber: number;
  title: string;
  updatedAt: Date;
};

type PromptRevisionRow = {
  promptId: string;
  author: PromptRevisionAuthor;
  changeRequest: string | null;
  markdown: string;
  createdAt: Date;
  id: string;
  parentRevisionId: string | null;
};

type PromptRevisionSummaryRow = Omit<PromptRevisionRow, "markdown">;

type PromptRevisionPointersRow = {
  activeRevisionId: string;
  currentRevisionId: string;
  redoRevisionIds: string[];
};

export class PromptConflictError extends Error {
  readonly statusCode = 409;

  constructor() {
    super("This prompt changed after it was loaded. Reload it before editing again.");
    this.name = "PromptConflictError";
  }
}

export class PromptNotFoundError extends Error {
  readonly statusCode = 404;

  constructor(promptId: string) {
    super(`Prompt ${promptId} was not found.`);
    this.name = "PromptNotFoundError";
  }
}

export class PromptRevisionNotFoundError extends Error {
  readonly statusCode = 404;

  constructor(promptId: string, revisionId: string) {
    super(`Revision ${revisionId} was not found for prompt ${promptId}.`);
    this.name = "PromptRevisionNotFoundError";
  }
}

export class PromptHistoryError extends Error {
  readonly statusCode = 409;

  constructor(message: string) {
    super(message);
    this.name = "PromptHistoryError";
  }
}

/** Owns prompt persistence and delegates active-revision retrieval to the shared search policy. */
export class PromptSystem {
  readonly #database: Database;
  readonly #search: PromptSearch;

  constructor(database: Database, search: HybridSearch) {
    this.#database = database;
    this.#search = createPromptSearch(search, () => this.listPrompts());
  }

  /** Searches saved prompts while preserving prompt-level and passage-level projections. */
  async searchPrompts(query: string): Promise<StoredPromptSearchResult[]> {
    return this.#search.searchPrompts(query);
  }

  /** Searches prompt passages and optionally narrows the result to one prompt. */
  async searchPassages(query: string, promptId?: string): Promise<PromptPassageHit[]> {
    return this.#search.searchPassages(query, promptId);
  }

  async listPrompts(): Promise<StoredPrompt[]> {
    return this.#database.run(async (sql) => {
      const rows = await sql<PromptRow[]>`
        SELECT
          prompts.id,
          prompts.title,
          prompts.active_revision_id AS revision_id,
          prompts.active_revision_id,
          prompt_revisions.revision_number AS active_revision_number,
          prompt_revisions.markdown,
          prompt_revisions.parent_revision_id IS NOT NULL AS can_undo,
          cardinality(prompts.redo_revision_ids) > 0 AS can_redo,
          prompt_revisions.revision_number,
          (
            SELECT count(*)::integer
            FROM prompt_revisions AS all_revisions
            WHERE all_revisions.prompt_id = prompts.id
          ) AS revision_count,
          prompts.created_at,
          prompts.updated_at
        FROM prompts
        JOIN prompt_revisions
          ON prompt_revisions.prompt_id = prompts.id
          AND prompt_revisions.id = prompts.active_revision_id
        ORDER BY prompts.updated_at DESC, prompts.id
      `;
      return rows.map(projectPrompt);
    });
  }

  async getPrompt(promptId: string): Promise<StoredPrompt> {
    return this.#database.run(async (sql) => {
      const prompt = await selectActivePrompt(sql, promptId);
      if (!prompt) throw new PromptNotFoundError(promptId);
      return prompt;
    });
  }

  async getEditorPrompt(promptId: string): Promise<StoredPrompt> {
    return this.#database.run(async (sql) => {
      const prompt = await selectEditorPrompt(sql, promptId);
      if (!prompt) throw new PromptNotFoundError(promptId);
      return prompt;
    });
  }

  async listRevisions(promptId: string): Promise<StoredPromptRevisionSummary[]> {
    return this.#database.run(async (sql) => {
      const prompt = await selectActivePrompt(sql, promptId);
      if (!prompt) throw new PromptNotFoundError(promptId);
      const rows = await sql<PromptRevisionSummaryRow[]>`
        SELECT id, prompt_id, parent_revision_id, change_request, author, created_at
        FROM prompt_revisions
        WHERE prompt_id = ${promptId}
        ORDER BY revision_number DESC
      `;
      return rows.map(projectRevisionSummary);
    });
  }

  async getRevision(promptId: string, revisionId: string): Promise<StoredPromptRevision> {
    return this.#database.run(async (sql) => {
      const [row] = await sql<PromptRevisionRow[]>`
        SELECT id, prompt_id, parent_revision_id, markdown, change_request, author, created_at
        FROM prompt_revisions
        WHERE prompt_id = ${promptId} AND id = ${revisionId}
      `;
      if (!row) throw new PromptRevisionNotFoundError(promptId, revisionId);
      return projectRevision(row);
    });
  }

  async createPrompt(input: { markdown: string; title: string }): Promise<StoredPrompt> {
    const title = input.title.trim();
    if (!title) throw new Error("Prompt title is required.");
    const promptId = randomUUID();
    const revisionId = randomUUID();
    return this.#database.transaction(async (sql) => {
      await sql`
        INSERT INTO prompts (id, title, current_revision_id, active_revision_id)
        VALUES (${promptId}, ${title}, ${revisionId}, ${revisionId})
      `;
      await sql`
        INSERT INTO prompt_revisions (id, prompt_id, revision_number, markdown, author)
        VALUES (${revisionId}, ${promptId}, 1, ${input.markdown}, 'human')
      `;
      return requireEditorPrompt(sql, promptId, "Created prompt could not be loaded.");
    });
  }

  async deletePrompt(promptId: string, expectedRevisionId: string): Promise<void> {
    await this.#database.transaction(async (sql) => {
      const [pointers] = await lockPrompt(sql, promptId);
      if (!pointers) throw new PromptNotFoundError(promptId);
      if (pointers.activeRevisionId !== expectedRevisionId) throw new PromptConflictError();
      await sql`DELETE FROM prompts WHERE id = ${promptId}`;
    });
  }

  async appendHumanEdit(input: {
    promptId: string;
    markdown: string;
    expectedRevisionId: string;
  }): Promise<StoredPrompt> {
    return this.#database.transaction(async (sql) => {
      const [pointers] = await lockPrompt(sql, input.promptId);
      if (!pointers) throw new PromptNotFoundError(input.promptId);
      if (pointers.currentRevisionId !== input.expectedRevisionId) throw new PromptConflictError();
      const existing = await requireEditorPrompt(
        sql,
        input.promptId,
        "Prompt could not be loaded.",
      );
      if (existing.markdown === input.markdown) return existing;
      const revisionId = randomUUID();
      await sql`
        INSERT INTO prompt_revisions (
          id,
          prompt_id,
          parent_revision_id,
          revision_number,
          markdown,
          change_request,
          author
        )
        VALUES (
          ${revisionId},
          ${input.promptId},
          ${input.expectedRevisionId},
          ${existing.revisionCount + 1},
          ${input.markdown},
          'Human prompt edit.',
          'human'
        )
      `;
      await selectSavedRevision(sql, input.promptId, revisionId);
      return requireEditorPrompt(sql, input.promptId, "Updated prompt could not be loaded.");
    });
  }

  async appendAiEdit(input: AiEditInput): Promise<StoredPrompt> {
    return this.#database.transaction((sql) => commitAiEdit(sql, input));
  }

  async undo(promptId: string, expectedRevisionId: string): Promise<StoredPrompt> {
    return this.#database.transaction(async (sql) => {
      const [pointers] = await lockPrompt(sql, promptId);
      if (!pointers) throw new PromptNotFoundError(promptId);
      if (pointers.currentRevisionId !== expectedRevisionId) throw new PromptConflictError();
      const [revision] = await sql<{ parentRevisionId: string | null }[]>`
        SELECT parent_revision_id
        FROM prompt_revisions
        WHERE prompt_id = ${promptId} AND id = ${pointers.currentRevisionId}
      `;
      if (!revision?.parentRevisionId) {
        throw new PromptHistoryError("There is no earlier saved revision to undo.");
      }
      await navigateHistory(sql, {
        promptId,
        redoRevisionIds: [pointers.currentRevisionId, ...pointers.redoRevisionIds],
        revisionId: revision.parentRevisionId,
      });
      return requireEditorPrompt(sql, promptId, "Undone prompt could not be loaded.");
    });
  }

  async redo(promptId: string, expectedRevisionId: string): Promise<StoredPrompt> {
    return this.#database.transaction(async (sql) => {
      const [pointers] = await lockPrompt(sql, promptId);
      if (!pointers) throw new PromptNotFoundError(promptId);
      if (pointers.currentRevisionId !== expectedRevisionId) throw new PromptConflictError();
      const [revisionId, ...redoRevisionIds] = pointers.redoRevisionIds;
      if (!revisionId) throw new PromptHistoryError("There is no saved revision to redo.");
      const [revision] = await sql<{ parentRevisionId: string | null }[]>`
        SELECT parent_revision_id
        FROM prompt_revisions
        WHERE prompt_id = ${promptId} AND id = ${revisionId}
      `;
      if (!revision || revision.parentRevisionId !== pointers.currentRevisionId) {
        throw new PromptHistoryError("The saved redo path is no longer valid.");
      }
      await navigateHistory(sql, { promptId, redoRevisionIds, revisionId });
      return requireEditorPrompt(sql, promptId, "Redone prompt could not be loaded.");
    });
  }

  async activateRevision(
    promptId: string,
    revisionId: string,
    expectedActiveRevisionId: string,
  ): Promise<StoredPrompt> {
    return this.#database.transaction(async (sql) => {
      const [pointers] = await lockPrompt(sql, promptId);
      if (!pointers) throw new PromptNotFoundError(promptId);
      if (pointers.activeRevisionId !== expectedActiveRevisionId) throw new PromptConflictError();
      const [revision] = await sql<{ id: string }[]>`
        SELECT id
        FROM prompt_revisions
        WHERE prompt_id = ${promptId} AND id = ${revisionId}
      `;
      if (!revision) throw new PromptRevisionNotFoundError(promptId, revisionId);
      await sql`
        UPDATE prompts
        SET active_revision_id = ${revisionId}
        WHERE id = ${promptId}
      `;
      return requireEditorPrompt(sql, promptId, "Activated prompt could not be loaded.");
    });
  }
}

async function commitAiEdit(sql: DatabaseClient, input: AiEditInput): Promise<StoredPrompt> {
  const [pointers] = await lockPrompt(sql, input.promptId);
  if (!pointers) throw new PromptNotFoundError(input.promptId);
  if (pointers.activeRevisionId !== input.expectedRevisionId) throw new PromptConflictError();

  const existing = await requireRevisionPrompt(
    sql,
    input.promptId,
    input.expectedRevisionId,
    "Prompt could not be loaded.",
  );
  let markdown = existing.markdown;
  let revisionId = input.expectedRevisionId;
  let revisionNumber = existing.revisionCount + 1;

  if (markdown !== input.visibleMarkdown) {
    const humanRevisionId = randomUUID();
    await sql`
      INSERT INTO prompt_revisions (
        id,
        prompt_id,
        parent_revision_id,
        revision_number,
        markdown,
        change_request,
        author
      )
      VALUES (
        ${humanRevisionId},
        ${input.promptId},
        ${revisionId},
        ${revisionNumber},
        ${input.visibleMarkdown},
        'Human prompt edit before the AI request.',
        'human'
      )
    `;
    markdown = input.visibleMarkdown;
    revisionId = humanRevisionId;
    revisionNumber += 1;
  }

  if (markdown !== input.editedMarkdown) {
    const aiRevisionId = randomUUID();
    await sql`
      INSERT INTO prompt_revisions (
        id,
        prompt_id,
        parent_revision_id,
        revision_number,
        markdown,
        change_request,
        author
      )
      VALUES (
        ${aiRevisionId},
        ${input.promptId},
        ${revisionId},
        ${revisionNumber},
        ${input.editedMarkdown},
        ${input.instruction},
        'ai'
      )
    `;
    revisionId = aiRevisionId;
  }

  if (revisionId === input.expectedRevisionId) return existing;
  await selectSavedRevision(sql, input.promptId, revisionId);
  return requireEditorPrompt(sql, input.promptId, "Updated prompt could not be loaded.");
}

async function selectActivePrompt(
  sql: DatabaseClient,
  promptId: string,
): Promise<StoredPrompt | undefined> {
  const [row] = await sql<PromptRow[]>`
    SELECT
      prompts.id,
      prompts.title,
      prompts.active_revision_id AS revision_id,
      prompts.active_revision_id,
      prompt_revisions.revision_number AS active_revision_number,
      prompt_revisions.markdown,
      prompt_revisions.parent_revision_id IS NOT NULL AS can_undo,
      cardinality(prompts.redo_revision_ids) > 0 AS can_redo,
      prompt_revisions.revision_number,
      (
        SELECT count(*)::integer
        FROM prompt_revisions AS all_revisions
        WHERE all_revisions.prompt_id = prompts.id
      ) AS revision_count,
      prompts.created_at,
      prompts.updated_at
    FROM prompts
    JOIN prompt_revisions
      ON prompt_revisions.prompt_id = prompts.id
      AND prompt_revisions.id = prompts.active_revision_id
    WHERE prompts.id = ${promptId}
  `;
  return row ? projectPrompt(row) : undefined;
}

async function selectEditorPrompt(
  sql: DatabaseClient,
  promptId: string,
): Promise<StoredPrompt | undefined> {
  const [row] = await sql<PromptRow[]>`
    SELECT
      prompts.id,
      prompts.title,
      prompts.current_revision_id AS revision_id,
      prompts.active_revision_id,
      active_revision.revision_number AS active_revision_number,
      editor_revision.markdown,
      editor_revision.parent_revision_id IS NOT NULL AS can_undo,
      cardinality(prompts.redo_revision_ids) > 0 AS can_redo,
      editor_revision.revision_number,
      (
        SELECT count(*)::integer
        FROM prompt_revisions AS all_revisions
        WHERE all_revisions.prompt_id = prompts.id
      ) AS revision_count,
      prompts.created_at,
      prompts.updated_at
    FROM prompts
    JOIN prompt_revisions AS editor_revision
      ON editor_revision.prompt_id = prompts.id
      AND editor_revision.id = prompts.current_revision_id
    JOIN prompt_revisions AS active_revision
      ON active_revision.prompt_id = prompts.id
      AND active_revision.id = prompts.active_revision_id
    WHERE prompts.id = ${promptId}
  `;
  return row ? projectPrompt(row) : undefined;
}

async function requireEditorPrompt(
  sql: DatabaseClient,
  promptId: string,
  message: string,
): Promise<StoredPrompt> {
  const prompt = await selectEditorPrompt(sql, promptId);
  if (!prompt) throw new Error(message);
  return prompt;
}

async function requireRevisionPrompt(
  sql: DatabaseClient,
  promptId: string,
  revisionId: string,
  message: string,
): Promise<StoredPrompt> {
  const prompt = await selectEditorPrompt(sql, promptId);
  if (!prompt) throw new Error(message);
  if (prompt.revisionId === revisionId) return prompt;
  const [revision] = await sql<{ markdown: string; revisionNumber: number }[]>`
    SELECT markdown, revision_number
    FROM prompt_revisions
    WHERE prompt_id = ${promptId} AND id = ${revisionId}
  `;
  if (!revision) throw new PromptRevisionNotFoundError(promptId, revisionId);
  return {
    ...prompt,
    markdown: revision.markdown,
    revisionId,
    revisionNumber: revision.revisionNumber,
  };
}

function lockPrompt(sql: DatabaseClient, promptId: string) {
  return sql<PromptRevisionPointersRow[]>`
    SELECT active_revision_id, current_revision_id, redo_revision_ids
    FROM prompts
    WHERE id = ${promptId}
    FOR UPDATE
  `;
}

async function selectSavedRevision(
  sql: DatabaseClient,
  promptId: string,
  revisionId: string,
): Promise<void> {
  await sql`
    UPDATE prompts
    SET
      current_revision_id = ${revisionId},
      active_revision_id = ${revisionId},
      redo_revision_ids = '{}',
      updated_at = now()
    WHERE id = ${promptId}
  `;
}

async function navigateHistory(
  sql: DatabaseClient,
  input: { promptId: string; redoRevisionIds: string[]; revisionId: string },
): Promise<void> {
  await sql`
    UPDATE prompts
    SET
      current_revision_id = ${input.revisionId},
      redo_revision_ids = ${sql.array(input.redoRevisionIds)}::uuid[]
    WHERE id = ${input.promptId}
  `;
}

function projectPrompt(row: PromptRow): StoredPrompt {
  return {
    activeRevisionId: row.activeRevisionId,
    activeRevisionNumber: row.activeRevisionNumber,
    canRedo: row.canRedo,
    canUndo: row.canUndo,
    markdown: row.markdown,
    createdAt: row.createdAt.toISOString(),
    id: row.id,
    revisionCount: row.revisionCount,
    revisionId: row.revisionId,
    revisionNumber: row.revisionNumber,
    title: row.title,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function projectRevision(row: PromptRevisionRow): StoredPromptRevision {
  return {
    ...projectRevisionSummary(row),
    markdown: row.markdown,
  };
}

function projectRevisionSummary(row: PromptRevisionSummaryRow): StoredPromptRevisionSummary {
  return {
    promptId: row.promptId,
    source: row.author,
    changeRequest: row.changeRequest,
    createdAt: row.createdAt.toISOString(),
    id: row.id,
    parentRevisionId: row.parentRevisionId,
  };
}
