/** Owns shared versioned contexts whose immutable revisions advance through one conflict-safe active head. */

import { randomUUID } from "node:crypto";

import type { Database, DatabaseClient } from "../database/index.ts";
import type { HybridSearch } from "../search.ts";
import {
  type ContextPassageHit,
  type ContextSearch,
  createContextSearch,
  type StoredContextSearchResult,
} from "./search.ts";
import { readSkillMetadata, type SkillMetadata } from "./skills.ts";

export type ContextRevisionAuthor = "ai" | "human";

export type StoredContext = {
  id: string;
  title: string;
  markdown: string;
  skill?: SkillMetadata;
  revisionId: string;
  revisionNumber: number;
  activeRevisionId: string;
  activeRevisionNumber: number;
  revisionCount: number;
  updatedAt: string;
};

export type StoredContextSummary = Omit<StoredContext, "markdown">;

export type StoredSkill = Pick<StoredContext, "id" | "revisionId" | "markdown"> & {
  skill: SkillMetadata;
};

export type StoredContextRevisionSummary = {
  id: string;
  contextId: string;
  parentRevisionId: string | null;
  source: ContextRevisionAuthor;
  changeRequest: string | null;
  createdByUserId: string;
  createdByName: string | null;
  createdAt: string;
};

export type StoredContextRevision = StoredContextRevisionSummary & {
  markdown: string;
  skill?: SkillMetadata;
};

export type AiEditInput = {
  contextId: string;
  expectedActiveRevisionId: string;
  visibleMarkdown: string;
  instruction: string;
  editedMarkdown: string;
};

type ContextRow = {
  id: string;
  title: string;
  markdown: string;
  skill: SkillMetadata | null;
  revisionId: string;
  revisionNumber: number;
  activeRevisionId: string;
  activeRevisionNumber: number;
  revisionCount: number;
  updatedAt: Date;
};

type ContextSummaryRow = Omit<ContextRow, "markdown">;

type ContextRevisionRow = {
  id: string;
  contextId: string;
  parentRevisionId: string | null;
  markdown: string;
  skill: SkillMetadata | null;
  author: ContextRevisionAuthor;
  changeRequest: string | null;
  createdByUserId: string;
  createdByName: string | null;
  createdAt: Date;
};

type ContextRevisionSummaryRow = Omit<ContextRevisionRow, "markdown" | "skill">;

type ContextHeadRow = {
  activeRevisionId: string;
  revisionCount: number;
};

export class ContextConflictError extends Error {
  readonly code = "stale-write";
  readonly currentActiveRevisionId: string;
  readonly statusCode = 409;

  constructor(currentActiveRevisionId: string) {
    super("Someone saved a newer context revision.");
    this.currentActiveRevisionId = currentActiveRevisionId;
    this.name = "ContextConflictError";
  }
}

export class ContextNotFoundError extends Error {
  readonly statusCode = 404;

  constructor(contextId: string) {
    super(`Context ${contextId} was not found.`);
    this.name = "ContextNotFoundError";
  }
}

export class ContextRevisionNotFoundError extends Error {
  readonly statusCode = 404;

  constructor(contextId: string, revisionId: string) {
    super(`Revision ${revisionId} was not found for context ${contextId}.`);
    this.name = "ContextRevisionNotFoundError";
  }
}

/** Owns context persistence and delegates active-revision retrieval to the shared search policy. */
export class ContextSystem {
  readonly #database: Database;
  readonly #search: ContextSearch;

  constructor(database: Database, search: HybridSearch) {
    this.#database = database;
    this.#search = createContextSearch(search, () => this.listContexts());
  }

  /** Searches saved contexts while preserving context-level and passage-level projections. */
  async searchContexts(query: string): Promise<StoredContextSearchResult[]> {
    return this.#search.searchContexts(query);
  }

  /** Searches context passages and optionally narrows the result to one context. */
  async searchPassages(query: string, contextId?: string): Promise<ContextPassageHit[]> {
    return this.#search.searchPassages(query, contextId);
  }

  async listContexts(): Promise<StoredContext[]> {
    return this.#database.run(async (sql) => {
      const rows = await sql<ContextRow[]>`
        SELECT
          contexts.id,
          contexts.title,
          contexts.active_revision_id AS revision_id,
          contexts.active_revision_id,
          context_revisions.revision_number AS active_revision_number,
          context_revisions.markdown,
          context_revisions.skill,
          context_revisions.revision_number,
          (
            SELECT count(*)::integer
            FROM context_revisions AS all_revisions
            WHERE all_revisions.context_id = contexts.id
          ) AS revision_count,
          contexts.updated_at
        FROM contexts
        JOIN context_revisions
          ON context_revisions.context_id = contexts.id
          AND context_revisions.id = contexts.active_revision_id
        ORDER BY contexts.updated_at DESC, contexts.id
      `;
      return rows.map(projectContext);
    });
  }

  /** Resolves the active skill catalogue once per agent run so subsequent edits cannot change that run's skill files. */
  async listSkills(): Promise<StoredSkill[]> {
    return this.#database.run(
      (sql) => sql<StoredSkill[]>`
      SELECT contexts.id, context_revisions.id AS revision_id, context_revisions.markdown, context_revisions.skill
      FROM contexts
      JOIN context_revisions ON context_revisions.context_id = contexts.id AND context_revisions.id = contexts.active_revision_id
      WHERE context_revisions.skill IS NOT NULL
      ORDER BY contexts.id
    `,
    );
  }

  /** Lists browser-facing context metadata without transferring active Markdown that callers do not consume. */
  async listContextSummaries(): Promise<StoredContextSummary[]> {
    return this.#database.run(async (sql) => {
      const rows = await sql<ContextSummaryRow[]>`
        SELECT
          contexts.id,
          contexts.title,
          contexts.active_revision_id AS revision_id,
          contexts.active_revision_id,
          context_revisions.skill,
          context_revisions.revision_number AS active_revision_number,
          context_revisions.revision_number,
          (
            SELECT count(*)::integer
            FROM context_revisions AS all_revisions
            WHERE all_revisions.context_id = contexts.id
          ) AS revision_count,
          contexts.updated_at
        FROM contexts
        JOIN context_revisions
          ON context_revisions.context_id = contexts.id
          AND context_revisions.id = contexts.active_revision_id
        ORDER BY contexts.updated_at DESC, contexts.id
      `;
      return rows.map(projectContextSummary);
    });
  }

  async getContext(contextId: string): Promise<StoredContext> {
    return this.#database.run((sql) => requireActiveContext(sql, contextId));
  }

  async listRevisions(contextId: string): Promise<StoredContextRevisionSummary[]> {
    return this.#database.run(async (sql) => {
      const rows = await sql<ContextRevisionSummaryRow[]>`
        SELECT
          context_revisions.id,
          context_revisions.context_id,
          context_revisions.parent_revision_id,
          context_revisions.change_request,
          context_revisions.author,
          context_revisions.created_by_user_id,
          auth_users.name AS created_by_name,
          context_revisions.created_at
        FROM context_revisions
        JOIN auth_users ON auth_users.id = context_revisions.created_by_user_id
        WHERE context_revisions.context_id = ${contextId}
        ORDER BY context_revisions.revision_number DESC
      `;
      if (rows.length === 0) throw new ContextNotFoundError(contextId);
      return rows.map(projectRevisionSummary);
    });
  }

  async getRevision(contextId: string, revisionId: string): Promise<StoredContextRevision> {
    return this.#database.run(async (sql) => {
      const [row] = await sql<ContextRevisionRow[]>`
        SELECT
          context_revisions.id,
          context_revisions.context_id,
          context_revisions.parent_revision_id,
          context_revisions.markdown,
          context_revisions.skill,
          context_revisions.change_request,
          context_revisions.author,
          context_revisions.created_by_user_id,
          auth_users.name AS created_by_name,
          context_revisions.created_at
        FROM context_revisions
        JOIN auth_users ON auth_users.id = context_revisions.created_by_user_id
        WHERE context_revisions.context_id = ${contextId} AND context_revisions.id = ${revisionId}
      `;
      if (!row) throw new ContextRevisionNotFoundError(contextId, revisionId);
      return projectRevision(row);
    });
  }

  async createContext(
    actorUserId: string,
    input: { markdown: string; title: string },
  ): Promise<StoredContext> {
    const title = input.title.trim();
    if (!title) throw new Error("Context title is required.");
    const skill = readSkillMetadata(input.markdown);
    const contextId = randomUUID();
    const revisionId = randomUUID();
    return this.#database.transaction(async (sql) => {
      await sql`
        INSERT INTO contexts (id, title, active_revision_id)
        VALUES (${contextId}, ${title}, ${revisionId})
      `;
      await sql`
        INSERT INTO context_revisions (
          id,
          context_id,
          revision_number,
          markdown,
          skill,
          author,
          created_by_user_id
        )
        VALUES (${revisionId}, ${contextId}, 1, ${input.markdown}, ${skill ? sql.json(skill) : null}, 'human', ${actorUserId})
      `;
      return requireActiveContext(sql, contextId);
    });
  }

  async deleteContext(contextId: string, expectedActiveRevisionId: string): Promise<void> {
    await this.#database.transaction(async (sql) => {
      const head = await requireLockedContext(sql, contextId);
      requireExpectedHead(head, expectedActiveRevisionId);
      await sql`DELETE FROM contexts WHERE id = ${contextId}`;
    });
  }

  async appendHumanEdit(
    actorUserId: string,
    input: { contextId: string; markdown: string; expectedActiveRevisionId: string },
  ): Promise<StoredContext> {
    readSkillMetadata(input.markdown);
    return this.#database.transaction(async (sql) => {
      const head = await requireLockedContext(sql, input.contextId);
      requireExpectedHead(head, input.expectedActiveRevisionId);
      const existing = await requireActiveContext(sql, input.contextId);
      if (existing.markdown === input.markdown) return existing;
      const revisionId = randomUUID();
      await insertRevision(sql, {
        actorUserId,
        author: "human",
        changeRequest: "Human context edit.",
        markdown: input.markdown,
        parentRevisionId: head.activeRevisionId,
        contextId: input.contextId,
        revisionId,
        revisionNumber: head.revisionCount + 1,
      });
      await activateSavedRevision(sql, input.contextId, revisionId);
      return requireActiveContext(sql, input.contextId);
    });
  }

  async appendAiEdit(actorUserId: string, input: AiEditInput): Promise<StoredContext> {
    readSkillMetadata(input.visibleMarkdown);
    readSkillMetadata(input.editedMarkdown);
    return this.#database.transaction((sql) => commitAiEdit(sql, actorUserId, input));
  }

  async activateRevision(
    contextId: string,
    revisionId: string,
    expectedActiveRevisionId: string,
  ): Promise<StoredContext> {
    return this.#database.transaction(async (sql) => {
      const head = await requireLockedContext(sql, contextId);
      requireExpectedHead(head, expectedActiveRevisionId);
      const [revision] = await sql<{ id: string }[]>`
        SELECT id
        FROM context_revisions
        WHERE context_id = ${contextId} AND id = ${revisionId}
      `;
      if (!revision) throw new ContextRevisionNotFoundError(contextId, revisionId);
      await activateSavedRevision(sql, contextId, revisionId);
      return requireActiveContext(sql, contextId);
    });
  }
}

async function commitAiEdit(
  sql: DatabaseClient,
  actorUserId: string,
  input: AiEditInput,
): Promise<StoredContext> {
  const head = await requireLockedContext(sql, input.contextId);
  requireExpectedHead(head, input.expectedActiveRevisionId);
  const existing = await requireActiveContext(sql, input.contextId);
  let markdown = existing.markdown;
  let revisionId = head.activeRevisionId;
  let revisionNumber = head.revisionCount + 1;

  if (markdown !== input.visibleMarkdown) {
    const humanRevisionId = randomUUID();
    await insertRevision(sql, {
      actorUserId,
      author: "human",
      changeRequest: "Human context edit before the AI request.",
      markdown: input.visibleMarkdown,
      parentRevisionId: revisionId,
      contextId: input.contextId,
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
      contextId: input.contextId,
      revisionId: aiRevisionId,
      revisionNumber,
    });
    revisionId = aiRevisionId;
  }

  if (revisionId === head.activeRevisionId) return existing;
  await activateSavedRevision(sql, input.contextId, revisionId);
  return requireActiveContext(sql, input.contextId);
}

async function insertRevision(
  sql: DatabaseClient,
  input: {
    actorUserId: string;
    author: ContextRevisionAuthor;
    changeRequest: string;
    markdown: string;
    parentRevisionId: string;
    contextId: string;
    revisionId: string;
    revisionNumber: number;
  },
): Promise<void> {
  const skill = readSkillMetadata(input.markdown);
  await sql`
    INSERT INTO context_revisions (
      id,
      context_id,
      parent_revision_id,
      revision_number,
      markdown,
      skill,
      change_request,
      author,
      created_by_user_id
    )
    VALUES (
      ${input.revisionId},
      ${input.contextId},
      ${input.parentRevisionId},
      ${input.revisionNumber},
      ${input.markdown},
      ${skill ? sql.json(skill) : null},
      ${input.changeRequest},
      ${input.author},
      ${input.actorUserId}
    )
  `;
}

async function selectActiveContext(
  sql: DatabaseClient,
  contextId: string,
): Promise<StoredContext | undefined> {
  const [row] = await sql<ContextRow[]>`
    SELECT
      contexts.id,
      contexts.title,
      contexts.active_revision_id AS revision_id,
      contexts.active_revision_id,
      context_revisions.revision_number AS active_revision_number,
      context_revisions.markdown,
      context_revisions.skill,
      context_revisions.revision_number,
      (
        SELECT count(*)::integer
        FROM context_revisions AS all_revisions
        WHERE all_revisions.context_id = contexts.id
      ) AS revision_count,
      contexts.updated_at
    FROM contexts
    JOIN context_revisions
      ON context_revisions.context_id = contexts.id
      AND context_revisions.id = contexts.active_revision_id
    WHERE contexts.id = ${contextId}
  `;
  return row ? projectContext(row) : undefined;
}

async function requireActiveContext(
  sql: DatabaseClient,
  contextId: string,
): Promise<StoredContext> {
  const context = await selectActiveContext(sql, contextId);
  if (!context) throw new ContextNotFoundError(contextId);
  return context;
}

async function requireLockedContext(
  sql: DatabaseClient,
  contextId: string,
): Promise<ContextHeadRow> {
  const [head] = await sql<ContextHeadRow[]>`
    SELECT
      active_revision_id,
      (
        SELECT count(*)::integer
        FROM context_revisions
        WHERE context_id = contexts.id
      ) AS revision_count
    FROM contexts
    WHERE id = ${contextId}
    FOR UPDATE
  `;
  if (!head) throw new ContextNotFoundError(contextId);
  return head;
}

function requireExpectedHead(head: ContextHeadRow, expectedActiveRevisionId: string): void {
  if (head.activeRevisionId !== expectedActiveRevisionId) {
    throw new ContextConflictError(head.activeRevisionId);
  }
}

async function activateSavedRevision(
  sql: DatabaseClient,
  contextId: string,
  revisionId: string,
): Promise<void> {
  await sql`
    UPDATE contexts
    SET active_revision_id = ${revisionId}, updated_at = now()
    WHERE id = ${contextId}
  `;
}

function projectContext(row: ContextRow): StoredContext {
  return {
    id: row.id,
    title: row.title,
    markdown: row.markdown,
    ...(row.skill && { skill: row.skill }),
    revisionId: row.revisionId,
    revisionNumber: row.revisionNumber,
    activeRevisionId: row.activeRevisionId,
    activeRevisionNumber: row.activeRevisionNumber,
    revisionCount: row.revisionCount,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function projectContextSummary(row: ContextSummaryRow): StoredContextSummary {
  return {
    id: row.id,
    title: row.title,
    ...(row.skill && { skill: row.skill }),
    revisionId: row.revisionId,
    revisionNumber: row.revisionNumber,
    activeRevisionId: row.activeRevisionId,
    activeRevisionNumber: row.activeRevisionNumber,
    revisionCount: row.revisionCount,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function projectRevision(row: ContextRevisionRow): StoredContextRevision {
  return {
    ...projectRevisionSummary(row),
    markdown: row.markdown,
    ...(row.skill && { skill: row.skill }),
  };
}

function projectRevisionSummary(row: ContextRevisionSummaryRow): StoredContextRevisionSummary {
  return {
    id: row.id,
    contextId: row.contextId,
    parentRevisionId: row.parentRevisionId,
    source: row.author,
    changeRequest: row.changeRequest,
    createdByUserId: row.createdByUserId,
    createdByName: row.createdByName,
    createdAt: row.createdAt.toISOString(),
  };
}
