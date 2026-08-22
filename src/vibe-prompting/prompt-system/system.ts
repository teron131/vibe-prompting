/** Owns shared versioned prompts whose immutable revisions advance through one conflict-safe active head. */

import { randomUUID } from "node:crypto";

import type { Database, DatabaseClient } from "../database/index.ts";
import type { HybridSearch } from "../search.ts";
import {
  createPromptSearch,
  type PromptPassageHit,
  type PromptSearch,
  type StoredPromptSearchResult,
} from "./search.ts";

export type PromptRevisionAuthor = "ai" | "human";

export type StoredPrompt = {
  id: string;
  title: string;
  markdown: string;
  revisionId: string;
  revisionNumber: number;
  activeRevisionId: string;
  activeRevisionNumber: number;
  revisionCount: number;
  updatedAt: string;
};

export type StoredPromptRevisionSummary = {
  id: string;
  promptId: string;
  parentRevisionId: string | null;
  source: PromptRevisionAuthor;
  changeRequest: string | null;
  createdByUserId: string;
  createdByName: string | null;
  createdAt: string;
};

export type StoredPromptRevision = StoredPromptRevisionSummary & { markdown: string };

export type AiEditInput = {
  promptId: string;
  expectedActiveRevisionId: string;
  visibleMarkdown: string;
  instruction: string;
  editedMarkdown: string;
};

type PromptRow = {
  id: string;
  title: string;
  markdown: string;
  revisionId: string;
  revisionNumber: number;
  activeRevisionId: string;
  activeRevisionNumber: number;
  revisionCount: number;
  updatedAt: Date;
};

type PromptRevisionRow = {
  id: string;
  promptId: string;
  parentRevisionId: string | null;
  markdown: string;
  author: PromptRevisionAuthor;
  changeRequest: string | null;
  createdByUserId: string;
  createdByName: string | null;
  createdAt: Date;
};

type PromptRevisionSummaryRow = Omit<PromptRevisionRow, "markdown">;

type PromptHeadRow = {
  activeRevisionId: string;
  revisionCount: number;
};

export class PromptConflictError extends Error {
  readonly code = "stale-write";
  readonly currentActiveRevisionId: string;
  readonly statusCode = 409;

  constructor(currentActiveRevisionId: string) {
    super("Someone saved a newer prompt revision.");
    this.currentActiveRevisionId = currentActiveRevisionId;
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
          prompt_revisions.revision_number,
          (
            SELECT count(*)::integer
            FROM prompt_revisions AS all_revisions
            WHERE all_revisions.prompt_id = prompts.id
          ) AS revision_count,
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
    return this.#database.run((sql) => requireActivePrompt(sql, promptId));
  }

  async listRevisions(promptId: string): Promise<StoredPromptRevisionSummary[]> {
    return this.#database.run(async (sql) => {
      await requireActivePrompt(sql, promptId);
      const rows = await sql<PromptRevisionSummaryRow[]>`
        SELECT
          prompt_revisions.id,
          prompt_revisions.prompt_id,
          prompt_revisions.parent_revision_id,
          prompt_revisions.change_request,
          prompt_revisions.author,
          prompt_revisions.created_by_user_id,
          auth_users.name AS created_by_name,
          prompt_revisions.created_at
        FROM prompt_revisions
        JOIN auth_users ON auth_users.id = prompt_revisions.created_by_user_id
        WHERE prompt_revisions.prompt_id = ${promptId}
        ORDER BY prompt_revisions.revision_number DESC
      `;
      return rows.map(projectRevisionSummary);
    });
  }

  async getRevision(promptId: string, revisionId: string): Promise<StoredPromptRevision> {
    return this.#database.run(async (sql) => {
      const [row] = await sql<PromptRevisionRow[]>`
        SELECT
          prompt_revisions.id,
          prompt_revisions.prompt_id,
          prompt_revisions.parent_revision_id,
          prompt_revisions.markdown,
          prompt_revisions.change_request,
          prompt_revisions.author,
          prompt_revisions.created_by_user_id,
          auth_users.name AS created_by_name,
          prompt_revisions.created_at
        FROM prompt_revisions
        JOIN auth_users ON auth_users.id = prompt_revisions.created_by_user_id
        WHERE prompt_revisions.prompt_id = ${promptId} AND prompt_revisions.id = ${revisionId}
      `;
      if (!row) throw new PromptRevisionNotFoundError(promptId, revisionId);
      return projectRevision(row);
    });
  }

  async createPrompt(
    actorUserId: string,
    input: { markdown: string; title: string },
  ): Promise<StoredPrompt> {
    const title = input.title.trim();
    if (!title) throw new Error("Prompt title is required.");
    const promptId = randomUUID();
    const revisionId = randomUUID();
    return this.#database.transaction(async (sql) => {
      await sql`
        INSERT INTO prompts (id, title, active_revision_id)
        VALUES (${promptId}, ${title}, ${revisionId})
      `;
      await sql`
        INSERT INTO prompt_revisions (
          id,
          prompt_id,
          revision_number,
          markdown,
          author,
          created_by_user_id
        )
        VALUES (${revisionId}, ${promptId}, 1, ${input.markdown}, 'human', ${actorUserId})
      `;
      return requireActivePrompt(sql, promptId);
    });
  }

  async deletePrompt(promptId: string, expectedActiveRevisionId: string): Promise<void> {
    await this.#database.transaction(async (sql) => {
      const head = await requireLockedPrompt(sql, promptId);
      requireExpectedHead(head, expectedActiveRevisionId);
      await sql`DELETE FROM prompts WHERE id = ${promptId}`;
    });
  }

  async appendHumanEdit(
    actorUserId: string,
    input: { promptId: string; markdown: string; expectedActiveRevisionId: string },
  ): Promise<StoredPrompt> {
    return this.#database.transaction(async (sql) => {
      const head = await requireLockedPrompt(sql, input.promptId);
      requireExpectedHead(head, input.expectedActiveRevisionId);
      const existing = await requireActivePrompt(sql, input.promptId);
      if (existing.markdown === input.markdown) return existing;
      const revisionId = randomUUID();
      await insertRevision(sql, {
        actorUserId,
        author: "human",
        changeRequest: "Human prompt edit.",
        markdown: input.markdown,
        parentRevisionId: head.activeRevisionId,
        promptId: input.promptId,
        revisionId,
        revisionNumber: head.revisionCount + 1,
      });
      await activateSavedRevision(sql, input.promptId, revisionId);
      return requireActivePrompt(sql, input.promptId);
    });
  }

  async appendAiEdit(actorUserId: string, input: AiEditInput): Promise<StoredPrompt> {
    return this.#database.transaction((sql) => commitAiEdit(sql, actorUserId, input));
  }

  async activateRevision(
    promptId: string,
    revisionId: string,
    expectedActiveRevisionId: string,
  ): Promise<StoredPrompt> {
    return this.#database.transaction(async (sql) => {
      const head = await requireLockedPrompt(sql, promptId);
      requireExpectedHead(head, expectedActiveRevisionId);
      const [revision] = await sql<{ id: string }[]>`
        SELECT id
        FROM prompt_revisions
        WHERE prompt_id = ${promptId} AND id = ${revisionId}
      `;
      if (!revision) throw new PromptRevisionNotFoundError(promptId, revisionId);
      await activateSavedRevision(sql, promptId, revisionId);
      return requireActivePrompt(sql, promptId);
    });
  }
}

async function commitAiEdit(
  sql: DatabaseClient,
  actorUserId: string,
  input: AiEditInput,
): Promise<StoredPrompt> {
  const head = await requireLockedPrompt(sql, input.promptId);
  requireExpectedHead(head, input.expectedActiveRevisionId);
  const existing = await requireActivePrompt(sql, input.promptId);
  let markdown = existing.markdown;
  let revisionId = head.activeRevisionId;
  let revisionNumber = head.revisionCount + 1;

  if (markdown !== input.visibleMarkdown) {
    const humanRevisionId = randomUUID();
    await insertRevision(sql, {
      actorUserId,
      author: "human",
      changeRequest: "Human prompt edit before the AI request.",
      markdown: input.visibleMarkdown,
      parentRevisionId: revisionId,
      promptId: input.promptId,
      revisionId: humanRevisionId,
      revisionNumber,
    });
    markdown = input.visibleMarkdown;
    revisionId = humanRevisionId;
    revisionNumber += 1;
  }

  if (markdown !== input.editedMarkdown) {
    const aiRevisionId = randomUUID();
    await insertRevision(sql, {
      actorUserId,
      author: "ai",
      changeRequest: input.instruction,
      markdown: input.editedMarkdown,
      parentRevisionId: revisionId,
      promptId: input.promptId,
      revisionId: aiRevisionId,
      revisionNumber,
    });
    revisionId = aiRevisionId;
  }

  if (revisionId === head.activeRevisionId) return existing;
  await activateSavedRevision(sql, input.promptId, revisionId);
  return requireActivePrompt(sql, input.promptId);
}

async function insertRevision(
  sql: DatabaseClient,
  input: {
    actorUserId: string;
    author: PromptRevisionAuthor;
    changeRequest: string;
    markdown: string;
    parentRevisionId: string;
    promptId: string;
    revisionId: string;
    revisionNumber: number;
  },
): Promise<void> {
  await sql`
    INSERT INTO prompt_revisions (
      id,
      prompt_id,
      parent_revision_id,
      revision_number,
      markdown,
      change_request,
      author,
      created_by_user_id
    )
    VALUES (
      ${input.revisionId},
      ${input.promptId},
      ${input.parentRevisionId},
      ${input.revisionNumber},
      ${input.markdown},
      ${input.changeRequest},
      ${input.author},
      ${input.actorUserId}
    )
  `;
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
      prompt_revisions.revision_number,
      (
        SELECT count(*)::integer
        FROM prompt_revisions AS all_revisions
        WHERE all_revisions.prompt_id = prompts.id
      ) AS revision_count,
      prompts.updated_at
    FROM prompts
    JOIN prompt_revisions
      ON prompt_revisions.prompt_id = prompts.id
      AND prompt_revisions.id = prompts.active_revision_id
    WHERE prompts.id = ${promptId}
  `;
  return row ? projectPrompt(row) : undefined;
}

async function requireActivePrompt(sql: DatabaseClient, promptId: string): Promise<StoredPrompt> {
  const prompt = await selectActivePrompt(sql, promptId);
  if (!prompt) throw new PromptNotFoundError(promptId);
  return prompt;
}

async function requireLockedPrompt(sql: DatabaseClient, promptId: string): Promise<PromptHeadRow> {
  const [head] = await sql<PromptHeadRow[]>`
    SELECT
      active_revision_id,
      (
        SELECT count(*)::integer
        FROM prompt_revisions
        WHERE prompt_id = prompts.id
      ) AS revision_count
    FROM prompts
    WHERE id = ${promptId}
    FOR UPDATE
  `;
  if (!head) throw new PromptNotFoundError(promptId);
  return head;
}

function requireExpectedHead(head: PromptHeadRow, expectedActiveRevisionId: string): void {
  if (head.activeRevisionId !== expectedActiveRevisionId) {
    throw new PromptConflictError(head.activeRevisionId);
  }
}

async function activateSavedRevision(
  sql: DatabaseClient,
  promptId: string,
  revisionId: string,
): Promise<void> {
  await sql`
    UPDATE prompts
    SET active_revision_id = ${revisionId}, updated_at = now()
    WHERE id = ${promptId}
  `;
}

function projectPrompt(row: PromptRow): StoredPrompt {
  return {
    id: row.id,
    title: row.title,
    markdown: row.markdown,
    revisionId: row.revisionId,
    revisionNumber: row.revisionNumber,
    activeRevisionId: row.activeRevisionId,
    activeRevisionNumber: row.activeRevisionNumber,
    revisionCount: row.revisionCount,
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
    id: row.id,
    promptId: row.promptId,
    parentRevisionId: row.parentRevisionId,
    source: row.author,
    changeRequest: row.changeRequest,
    createdByUserId: row.createdByUserId,
    createdByName: row.createdByName,
    createdAt: row.createdAt.toISOString(),
  };
}
