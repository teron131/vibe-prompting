/** Owns durable prompt identity, optimistic concurrency, and immutable Markdown revisions in PostgreSQL. */

import { randomUUID } from "node:crypto";

import type { Database, DatabaseClient } from "../storage/database.ts";

export type PromptRevisionSource = "operator" | "user";

export type StoredPrompt = {
  createdAt: string;
  id: string;
  markdown: string;
  revisionCount: number;
  revisionId: string;
  title: string;
  updatedAt: string;
};

export type StoredPromptRevision = {
  changeRequest: string | null;
  createdAt: string;
  id: string;
  markdown: string;
  parentRevisionId: string | null;
  promptId: string;
  source: PromptRevisionSource;
};

export type AgentEditInput = {
  editedMarkdown: string;
  expectedRevisionId: string;
  instruction: string;
  promptId: string;
  visibleMarkdown: string;
};

type PromptRow = {
  createdAt: Date;
  id: string;
  markdown: string;
  revisionCount: number;
  revisionId: string;
  title: string;
  updatedAt: Date;
};

type PromptRevisionRow = {
  changeRequest: string | null;
  createdAt: Date;
  id: string;
  markdown: string;
  parentRevisionId: string | null;
  promptId: string;
  source: PromptRevisionSource;
};

type CurrentRevisionRow = {
  currentRevisionId: string;
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

export class PromptStore {
  readonly #database: Database;

  constructor(database: Database) {
    this.#database = database;
  }

  async listPrompts(): Promise<StoredPrompt[]> {
    return this.#database.run(async (sql) => {
      const rows = await sql<PromptRow[]>`
        SELECT
          prompts.id,
          prompts.title,
          prompts.current_revision_id AS revision_id,
          prompt_revisions.markdown,
          count(all_revisions.id)::integer AS revision_count,
          prompts.created_at,
          prompts.updated_at
        FROM prompts
        JOIN prompt_revisions ON prompt_revisions.id = prompts.current_revision_id
        JOIN prompt_revisions AS all_revisions ON all_revisions.prompt_id = prompts.id
        GROUP BY prompts.id, prompt_revisions.markdown
        ORDER BY prompts.updated_at DESC, prompts.id
      `;
      return rows.map(projectPrompt);
    });
  }

  async getPrompt(promptId: string): Promise<StoredPrompt> {
    return this.#database.run(async (sql) => {
      const prompt = await selectPrompt(sql, promptId);
      if (!prompt) throw new PromptNotFoundError(promptId);
      return prompt;
    });
  }

  async listRevisions(promptId: string): Promise<StoredPromptRevision[]> {
    return this.#database.run(async (sql) => {
      const prompt = await selectPrompt(sql, promptId);
      if (!prompt) throw new PromptNotFoundError(promptId);
      const rows = await sql<PromptRevisionRow[]>`
        SELECT
          id,
          prompt_id,
          parent_revision_id,
          markdown,
          change_request,
          source,
          created_at
        FROM prompt_revisions
        WHERE prompt_id = ${promptId}
        ORDER BY created_at DESC, id DESC
      `;
      return rows.map(projectRevision);
    });
  }

  async createPrompt(input: { markdown: string; title: string }): Promise<StoredPrompt> {
    const title = input.title.trim();
    if (!title) throw new Error("Prompt title is required.");
    const promptId = randomUUID();
    const revisionId = randomUUID();
    return this.#database.transaction(async (sql) => {
      await sql`
        INSERT INTO prompts (id, title, current_revision_id)
        VALUES (${promptId}, ${title}, ${revisionId})
      `;
      await sql`
        INSERT INTO prompt_revisions (id, prompt_id, markdown, source)
        VALUES (${revisionId}, ${promptId}, ${input.markdown}, 'user')
      `;
      return requirePrompt(sql, promptId, "Created prompt could not be loaded.");
    });
  }

  async appendManualEdit(input: {
    expectedRevisionId: string;
    markdown: string;
    promptId: string;
  }): Promise<StoredPrompt> {
    return this.#database.transaction(async (sql) => {
      const [current] = await lockPrompt(sql, input.promptId);
      if (!current) throw new PromptNotFoundError(input.promptId);
      if (current.currentRevisionId !== input.expectedRevisionId) throw new PromptConflictError();
      const existing = await requirePrompt(sql, input.promptId, "Prompt could not be loaded.");
      if (existing.markdown === input.markdown) return existing;
      const revisionId = randomUUID();
      await sql`
        INSERT INTO prompt_revisions (
          id,
          prompt_id,
          parent_revision_id,
          markdown,
          change_request,
          source
        )
        VALUES (
          ${revisionId},
          ${input.promptId},
          ${input.expectedRevisionId},
          ${input.markdown},
          'Manual prompt edit.',
          'user'
        )
      `;
      await selectCurrentRevision(sql, input.promptId, revisionId);
      return requirePrompt(sql, input.promptId, "Updated prompt could not be loaded.");
    });
  }

  async appendAgentEdit(input: AgentEditInput): Promise<StoredPrompt> {
    return this.#database.transaction((sql) => appendAgentEdit(sql, input));
  }
}

export async function appendAgentEdit(
  sql: DatabaseClient,
  input: AgentEditInput,
): Promise<StoredPrompt> {
  const [current] = await lockPrompt(sql, input.promptId);
  if (!current) throw new PromptNotFoundError(input.promptId);
  if (current.currentRevisionId !== input.expectedRevisionId) throw new PromptConflictError();

  const existing = await requirePrompt(sql, input.promptId, "Prompt could not be loaded.");
  let markdown = existing.markdown;
  let revisionId = input.expectedRevisionId;

  if (markdown !== input.visibleMarkdown) {
    const manualRevisionId = randomUUID();
    await sql`
      INSERT INTO prompt_revisions (
        id,
        prompt_id,
        parent_revision_id,
        markdown,
        change_request,
        source
      )
      VALUES (
        ${manualRevisionId},
        ${input.promptId},
        ${revisionId},
        ${input.visibleMarkdown},
        'Manual edit before the Operator request.',
        'user'
      )
    `;
    markdown = input.visibleMarkdown;
    revisionId = manualRevisionId;
  }

  if (markdown !== input.editedMarkdown) {
    const agentRevisionId = randomUUID();
    await sql`
      INSERT INTO prompt_revisions (
        id,
        prompt_id,
        parent_revision_id,
        markdown,
        change_request,
        source
      )
      VALUES (
        ${agentRevisionId},
        ${input.promptId},
        ${revisionId},
        ${input.editedMarkdown},
        ${input.instruction},
        'operator'
      )
    `;
    revisionId = agentRevisionId;
  }

  if (revisionId === input.expectedRevisionId) return existing;
  await selectCurrentRevision(sql, input.promptId, revisionId);
  return requirePrompt(sql, input.promptId, "Updated prompt could not be loaded.");
}

async function selectPrompt(
  sql: DatabaseClient,
  promptId: string,
): Promise<StoredPrompt | undefined> {
  const [row] = await sql<PromptRow[]>`
    SELECT
      prompts.id,
      prompts.title,
      prompts.current_revision_id AS revision_id,
      prompt_revisions.markdown,
      (
        SELECT count(*)::integer
        FROM prompt_revisions AS all_revisions
        WHERE all_revisions.prompt_id = prompts.id
      ) AS revision_count,
      prompts.created_at,
      prompts.updated_at
    FROM prompts
    JOIN prompt_revisions ON prompt_revisions.id = prompts.current_revision_id
    WHERE prompts.id = ${promptId}
  `;
  return row ? projectPrompt(row) : undefined;
}

async function requirePrompt(
  sql: DatabaseClient,
  promptId: string,
  message: string,
): Promise<StoredPrompt> {
  const prompt = await selectPrompt(sql, promptId);
  if (!prompt) throw new Error(message);
  return prompt;
}

function lockPrompt(sql: DatabaseClient, promptId: string) {
  return sql<CurrentRevisionRow[]>`
    SELECT current_revision_id
    FROM prompts
    WHERE id = ${promptId}
    FOR UPDATE
  `;
}

async function selectCurrentRevision(
  sql: DatabaseClient,
  promptId: string,
  revisionId: string,
): Promise<void> {
  await sql`
    UPDATE prompts
    SET current_revision_id = ${revisionId}, updated_at = now()
    WHERE id = ${promptId}
  `;
}

function projectPrompt(row: PromptRow): StoredPrompt {
  return {
    createdAt: row.createdAt.toISOString(),
    id: row.id,
    markdown: row.markdown,
    revisionCount: row.revisionCount,
    revisionId: row.revisionId,
    title: row.title,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function projectRevision(row: PromptRevisionRow): StoredPromptRevision {
  return {
    changeRequest: row.changeRequest,
    createdAt: row.createdAt.toISOString(),
    id: row.id,
    markdown: row.markdown,
    parentRevisionId: row.parentRevisionId,
    promptId: row.promptId,
    source: row.source,
  };
}
