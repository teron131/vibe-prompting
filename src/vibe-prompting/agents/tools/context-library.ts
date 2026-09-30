/** Owns the toolkit that exposes durable Context System operations to agent runtimes. */

import { z } from "zod";

import {
  ContextConflictError,
  type ContextSystem,
  type StoredContext,
} from "../../context-system/index.ts";
import { type AgentTool, AgentToolkit, defineAgentTool, requireAgentActor } from "./api.ts";
import {
  applyHashlineEdits,
  formatHashlines,
  hashlineEditsSchema,
  type ScopedDocument,
} from "./hashline.ts";

const contextEditRequestSchema = z.object({
  contextId: z.uuid().describe("Saved context ID."),
  expectedRevisionId: z.uuid().describe("Active revision ID expected by this edit."),
  changeRequest: z.string().trim().min(1).describe("Concise reason for the revision."),
  edits: hashlineEditsSchema,
});

export class ContextLibraryToolkit extends AgentToolkit {
  constructor(contexts: ContextSystem) {
    super("context-library", [
      defineAgentTool({
        name: "list_contexts",
        title: "List contexts",
        description:
          "List all saved contexts at their active revisions, including stable context IDs, active revision IDs, titles, revision counts, and update times.",
        parameters: z.object({}),
        annotations: { readOnlyHint: true, openWorldHint: false },
        async execute() {
          return {
            contexts: (await contexts.listContexts()).map((context) =>
              projectStoredContext(context),
            ),
          };
        },
      }),
      defineAgentTool({
        name: "read_context",
        title: "Read context",
        description:
          "Read one saved context's active revision with current LINE#HASH physical-line references for structured editing.",
        parameters: z.object({ contextId: z.uuid().describe("Saved context ID.") }),
        annotations: { readOnlyHint: true, openWorldHint: false },
        async execute({ contextId }) {
          const context = await contexts.getContext(contextId);
          return {
            ...projectStoredContext(context),
            content: formatHashlines(context.markdown),
          };
        },
      }),
      defineAgentTool({
        name: "search_contexts",
        title: "Search contexts",
        description:
          "Search saved context titles and active-revision passages, returning matching context summaries with ranked passage excerpts.",
        parameters: z.object({
          query: z.string().trim().min(2).max(200).describe("Context title or passage query."),
        }),
        annotations: { readOnlyHint: true, openWorldHint: false },
        async execute({ query }) {
          return {
            contexts: (await contexts.searchContexts(query)).map(
              ({ markdown: _markdown, ...context }) => context,
            ),
          };
        },
      }),
      defineAgentTool({
        name: "create_context",
        title: "Create context",
        description:
          "Create a saved context (prompt or skill) and its initial immutable Markdown revision. A skill starts with standard SKILL.md YAML frontmatter containing name and description, followed by instructions. Saved skills are available when Skills is enabled on subsequent agent runs.",
        parameters: z.object({
          title: z.string().trim().min(1).describe("Human-readable context title."),
          markdown: z
            .string()
            .min(1)
            .describe("Complete initial context Markdown or standard SKILL.md."),
        }),
        annotations: { destructiveHint: false, openWorldHint: false },
        async execute(input, toolContext) {
          const { actorUserId } = requireAgentActor(toolContext);
          const context = await contexts.createContext(actorUserId, input);
          return contextResult(context, "Created context.");
        },
      }),
      defineAgentTool({
        name: "edit_context",
        title: "Edit context",
        description:
          "Append one immutable AI-authored revision by applying an atomic batch of replace_range, insert_before, insert_after, or append operations addressed by current LINE#HASH refs. Edit content contains complete physical lines without refs.",
        parameters: contextEditRequestSchema,
        annotations: { destructiveHint: false, openWorldHint: false },
        async execute(input, context) {
          const { actorUserId } = requireAgentActor(context);
          const saved = await editStoredContext(contexts, actorUserId, input);
          return contextResult(saved, "Updated context.");
        },
      }),
    ]);
  }
}

async function editStoredContext(
  contexts: ContextSystem,
  actorUserId: string,
  { changeRequest, edits, expectedRevisionId, contextId }: z.infer<typeof contextEditRequestSchema>,
): Promise<StoredContext> {
  const active = await contexts.getContext(contextId);
  if (active.activeRevisionId !== expectedRevisionId) {
    throw new ContextConflictError(active.activeRevisionId);
  }
  const editedMarkdown = applyHashlineEdits(active.markdown, edits);
  return contexts.appendAiEdit(actorUserId, {
    contextId,
    expectedActiveRevisionId: expectedRevisionId,
    visibleMarkdown: active.markdown,
    instruction: changeRequest,
    editedMarkdown,
  });
}

export function projectStoredContext(context: StoredContext, includeMarkdown = false) {
  return {
    id: context.id,
    revisionId: context.revisionId,
    title: context.title,
    ...(context.skill && { skill: context.skill }),
    ...(includeMarkdown && { markdown: context.markdown }),
    revisionCount: context.revisionCount,
    updatedAt: context.updatedAt,
  };
}

function contextResult(context: StoredContext, summary: string) {
  return {
    artifact: storedContextLink(context),
    context: projectStoredContext(context, true),
    summary,
  };
}

export function storedContextLink(context: StoredContext) {
  return {
    id: context.id,
    kind: "context",
    revisionId: context.revisionId,
    title: context.title,
    href: `/contexts/${context.id}`,
  };
}

/** Binds generic document operations to the existing context-edit tool names and input schemas. */
export function createContextEditTools(document: ScopedDocument): AgentTool[] {
  return [
    defineAgentTool({
      name: "read_context",
      title: "Read working context",
      description:
        "Read the complete working context with current LINE#HASH physical-line references for structured editing.",
      parameters: z.object({}),
      annotations: { readOnlyHint: true, openWorldHint: false },
      async execute() {
        return formatHashlines(document.read());
      },
    }),
    defineAgentTool({
      name: "edit_context",
      title: "Edit working context",
      description:
        "Update the in-memory working context with an atomic batch of replace_range, insert_before, insert_after, or append operations addressed by current LINE#HASH refs. Edit content contains complete physical lines without refs.",
      parameters: z.object({
        edits: hashlineEditsSchema,
      }),
      annotations: { destructiveHint: false, openWorldHint: false },
      async execute({ edits }) {
        document.applyEdits(edits);
        return "Updated the working context.";
      },
    }),
  ];
}
