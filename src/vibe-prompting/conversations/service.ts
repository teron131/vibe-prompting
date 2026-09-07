/** Owns private chat commands, contextual input, detached assistant execution, and persisted outcomes independently of browser lifetime. */

import {
  type AgentStreamEvent,
  type ChatRunInput,
  streamChatRun,
} from "../agents/openai-agents/runtime.ts";
import type { AuthService } from "../auth/index.ts";
import { PromptRevisionNotFoundError, type StoredPrompt } from "../prompt-system/index.ts";
import type { StoredTargetRun } from "../target/runs/index.ts";
import { generateChatMetadata } from "./metadata.ts";
import {
  ChatRequestError,
  parseChatRequest,
  parseSteeringRequest,
  requireRecord,
  requireUuid,
} from "./requests.ts";
import { ConversationRunRegistry } from "./runs.ts";
import type {
  ChatQuote,
  ChatResponse,
  ChatRun,
  Conversation,
  DeleteChatResponse,
  SteerChatResponse,
  StopChatResponse,
  MessagePart as StoredMessagePart,
  TargetRunQuote,
} from "./schemas.ts";
import type { ConversationStore } from "./store.ts";

type Dependencies = Pick<
  ChatRunInput,
  "prompts" | "criterion" | "evaluations" | "evaluationResults" | "targetRuns" | "scenarios"
> & { auth: AuthService; modelContext: NonNullable<ChatRunInput["modelContext"]> };
type StoredQuote = Extract<StoredMessagePart, { type: "prompt-quote" | "target-run-quote" }>;
type ResolvedQuote = { context: string; part: StoredQuote };
const METADATA_EVERY_MESSAGES = 3;

/** Keeps authorization, run admission, persistence, and cleanup behind complete conversation operations. */
export class ConversationService {
  readonly #store: ConversationStore;
  readonly #dependencies: Dependencies;
  readonly #runs = new ConversationRunRegistry();
  readonly #commands = new Set<Promise<unknown>>();
  #closed = false;
  #closing: Promise<void> | undefined;

  constructor(store: ConversationStore, dependencies: Dependencies) {
    this.#store = store;
    this.#dependencies = dependencies;
  }

  /** Validates and saves one user message before starting a detached reply; replacement rewrites the selected message's suffix. */
  send(actorUserId: string, rawInput: unknown): Promise<ChatRun> {
    return this.#command(async () => {
      const input = parseChatRequest(rawInput);
      const { auth, ...services } = this.#dependencies;
      await auth.requireActiveUser(actorUserId);
      this.#requireModel(input.modelId);
      const [activePrompt, quotes] = await Promise.all([
        input.workspace.activePromptId
          ? services.prompts.getPrompt(input.workspace.activePromptId)
          : undefined,
        resolveChatQuotes(services, actorUserId, input.quotes),
      ]);
      let conversation = await this.#store.findConversation(actorUserId, input.chatId);
      const existing = Boolean(conversation);
      if (!existing && input.replaceFromMessageId)
        throw new ChatRequestError(`Chat ${input.chatId} was not found.`, 404);
      const claim = this.#runs.claim(input.chatId);
      try {
        const message = {
          attachments: input.attachments.map((attachment) => ({
            ...attachment,
            type: "file" as const,
          })),
          chatId: input.chatId,
          context: input.workspace,
          instruction: input.instruction,
          messageId: input.messageId,
          modelId: input.modelId,
          quotes: quotes.map(({ part }) => part),
        };
        conversation = input.replaceFromMessageId
          ? await this.#store.replaceUserMessage(actorUserId, {
              ...message,
              replaceFromMessageId: input.replaceFromMessageId,
            })
          : existing
            ? await this.#store.appendUserMessage(actorUserId, message)
            : await this.#store.createWithUserMessage(actorUserId, message);
        const saved = conversation;
        const history = projectRunHistory(saved.messages, input.messageId);
        const userMessageCount = saved.messages.filter(({ role }) => role === "user").length;
        const shouldUpdateMetadata =
          Boolean(input.replaceFromMessageId) ||
          !existing ||
          userMessageCount % METADATA_EVERY_MESSAGES === 0;
        claim.start(async () => {
          const metadataPromise = shouldUpdateMetadata
            ? this.#updateMetadata(actorUserId, saved)
            : undefined;
          try {
            const collected = new CollectedAssistantParts();
            const result = await streamChatRun(
              {
                ...services,
                actorUserId,
                chatId: input.chatId,
                instruction: formatWorkspaceInstruction(
                  input.instruction,
                  activePrompt,
                  quotes.map(({ context }) => context),
                ),
                history,
                attachments: input.attachments,
                modelId: input.modelId,
                reasoningEffort: input.workspace.reasoningEffort,
                enabledTools: input.workspace.enabledTools,
                signal: claim.signal,
                steering: claim.steering,
              },
              (event) => {
                collected.add(event);
                claim.publish(event);
              },
            );
            claim.signal.throwIfAborted();
            await this.#store.appendAssistantMessage(actorUserId, {
              chatId: input.chatId,
              metadata: {
                completedAt: new Date().toISOString(),
                activePromptId: activePrompt?.id ?? null,
                activePromptRevisionId: activePrompt?.revisionId ?? null,
                enabledTools: input.workspace.enabledTools,
                modelId: result.model.id,
                reasoningEffort: input.workspace.reasoningEffort,
                telemetry: result.telemetry,
              },
              parts: collected.finish(result.message),
            });
            const metadata = await metadataPromise;
            if (metadata)
              claim.publish({ chatId: input.chatId, ...metadata, type: "chat-metadata" });
            claim.publish({ type: "finish" });
          } finally {
            await metadataPromise;
          }
        });
        return { chatId: input.chatId, completion: claim.completion, subscribe: claim.subscribe };
      } catch (error) {
        claim.release();
        throw error;
      }
    });
  }

  /** Checks chat ownership before exposing buffered activity or saved history for reconnecting clients. */
  inspect(actorUserId: string, rawChatId: unknown): Promise<ChatResponse> {
    return this.#command(async () => {
      const chatId = requireUuid(rawChatId, "Chat ID");
      await this.#dependencies.auth.requireActiveUser(actorUserId);
      await this.#store.requireChat(actorUserId, chatId);
      const run = this.#runs.snapshot(chatId);
      return {
        active: run.active,
        conversation: await this.#store.getConversation(actorUserId, chatId),
        events: run.events,
      };
    });
  }

  /** Stops only an owned chat and lets detached cleanup retain ownership of its terminal event. */
  stop(actorUserId: string, rawInput: unknown): Promise<StopChatResponse> {
    return this.#command(async () => {
      const chatId = requireUuid(requireRecord(rawInput).chatId, "Chat ID");
      await this.#dependencies.auth.requireActiveUser(actorUserId);
      await this.#store.requireChat(actorUserId, chatId);
      return { stopped: this.#runs.stop(chatId) };
    });
  }

  /** Delivers steering to the current run and records the accepted instruction as a user turn. */
  steer(actorUserId: string, rawInput: unknown): Promise<SteerChatResponse> {
    return this.#command(async () => {
      const input = parseSteeringRequest(rawInput);
      await this.#dependencies.auth.requireActiveUser(actorUserId);
      this.#requireModel(input.modelId);
      await this.#store.requireChat(actorUserId, input.chatId);
      if (!this.#runs.steer(input.chatId, input.instruction))
        throw new ChatRequestError("The agent run is no longer available to steer.", 409);
      await this.#store.appendUserMessage(actorUserId, {
        attachments: [],
        chatId: input.chatId,
        context: input.workspace,
        instruction: input.instruction,
        messageId: input.messageId,
        modelId: input.modelId,
        quotes: [],
      });
      return { accepted: true };
    });
  }

  /** Waits for the owned run and metadata writes to settle before deleting the conversation. */
  delete(actorUserId: string, rawChatId: unknown): Promise<DeleteChatResponse> {
    return this.#command(async () => {
      const chatId = requireUuid(rawChatId, "Chat ID");
      await this.#dependencies.auth.requireActiveUser(actorUserId);
      await this.#store.requireChat(actorUserId, chatId);
      await this.#runs.stopAndWait(chatId);
      await this.#store.deleteChat(actorUserId, chatId);
      return { deleted: true };
    });
  }

  listChats(actorUserId: string, input: Parameters<ConversationStore["listChats"]>[1]) {
    return this.#command(async () => {
      await this.#dependencies.auth.requireActiveUser(actorUserId);
      return this.#store.listChats(actorUserId, input);
    });
  }

  searchChats(actorUserId: string, query: string) {
    return this.#command(async () => {
      await this.#dependencies.auth.requireActiveUser(actorUserId);
      return this.#store.searchChats(actorUserId, query);
    });
  }

  /** Stops new commands and waits for both accepted preparation and detached replies before storage disposal. */
  close(): Promise<void> {
    this.#closing ??= (async () => {
      this.#closed = true;
      const runs = this.#runs.close();
      await Promise.allSettled(this.#commands);
      await runs;
    })();
    return this.#closing;
  }

  #command<T>(operation: () => Promise<T>): Promise<T> {
    if (this.#closed) return Promise.reject(new Error("Conversation service is closed."));
    const pending = Promise.resolve().then(operation);
    this.#commands.add(pending);
    void pending.then(
      () => this.#commands.delete(pending),
      () => this.#commands.delete(pending),
    );
    return pending;
  }

  #requireModel(id: string): void {
    if (!this.#dependencies.modelContext.readConfig().models.some((model) => model.id === id))
      throw new ChatRequestError(`Unknown configured model: ${id}.`, 400);
  }

  async #updateMetadata(actorUserId: string, conversation: Conversation) {
    try {
      const metadata = await generateChatMetadata(
        {
          currentIcon: conversation.chat.icon,
          currentTitle: conversation.chat.title,
          messages: conversation.messages,
        },
        this.#dependencies.modelContext,
      );
      if (!metadata) return null;
      await this.#store.updateMetadata(actorUserId, { chatId: conversation.chat.id, ...metadata });
      return metadata;
    } catch (error) {
      console.warn("Chat metadata update failed", conversation.chat.id, error);
      return null;
    }
  }
}

class CollectedAssistantParts {
  #activity: StoredMessagePart[] = [];
  readonly #revisions = new Map<string, Extract<StoredMessagePart, { type: "prompt-revision" }>>();
  readonly #tools = new Map<string, Extract<StoredMessagePart, { type: "tool" }>>();

  add(event: AgentStreamEvent): void {
    if (event.type === "response-reset") {
      this.#activity = this.#activity.filter((part) => part.type !== "reasoning");
    } else if (event.type === "reasoning") {
      this.#activity.push({ type: "reasoning", summary: event.summary });
    } else if (event.type === "tool") {
      const existing = this.#tools.get(event.callId);
      if (existing) Object.assign(existing, event);
      else {
        const tool = { ...event };
        this.#tools.set(event.callId, tool);
        this.#activity.push(tool);
      }
    } else if (event.type === "prompt-revision") {
      this.#revisions.set(`${event.promptId}:${event.revisionId}`, event);
    }
  }

  finish(message: string): StoredMessagePart[] {
    return [...this.#activity, { type: "text", text: message }, ...this.#revisions.values()];
  }
}

function projectRunHistory(
  messages: ChatResponse["conversation"]["messages"],
  currentMessageId: string,
): Array<{ role: "assistant" | "user"; text: string }> {
  return messages.flatMap((message) => {
    if (message.id === currentMessageId) return [];
    const text = message.parts
      .filter(
        (part) =>
          part.type === "text" || part.type === "prompt-quote" || part.type === "target-run-quote",
      )
      .map((part) =>
        part.type === "prompt-quote"
          ? `Quoted from ${part.title} revision ${part.revisionId.slice(0, 8)}:\n${part.text}`
          : part.type === "target-run-quote"
            ? `Quoted Target Run ${part.runId}: ${part.title}`
            : part.text,
      )
      .join("\n");
    return text ? [{ role: message.role, text }] : [];
  });
}

async function resolveChatQuotes(
  services: Pick<Dependencies, "prompts" | "targetRuns">,
  viewerUserId: string,
  quotes: ChatQuote[],
): Promise<ResolvedQuote[]> {
  return Promise.all(
    quotes.map(async (quote) => {
      if (isTargetRunQuote(quote)) {
        const run = await services.targetRuns.getRun(viewerUserId, quote.runId);
        return {
          context: formatTargetRunContext(run),
          part: { runId: run.id, title: run.promptTitle, type: "target-run-quote" },
        };
      }
      const prompt = await services.prompts.getPrompt(quote.promptId);
      const revision = await services.prompts
        .getRevision(quote.promptId, quote.revisionId)
        .catch((error) => {
          if (error instanceof PromptRevisionNotFoundError) {
            throw new ChatRequestError("A quoted prompt revision was not found.", 400);
          }
          throw error;
        });
      if (!revision.markdown.includes(quote.text))
        throw new ChatRequestError("Quoted prompt text no longer matches its revision.", 400);
      return {
        context: `Quoted passage from ${prompt.title} (prompt ${quote.promptId}, revision ${quote.revisionId}):\n<prompt_quote>\n${quote.text}\n</prompt_quote>`,
        part: { ...quote, title: prompt.title, type: "prompt-quote" },
      };
    }),
  );
}

function formatWorkspaceInstruction(
  instruction: string,
  activePrompt: StoredPrompt | undefined,
  quoteContexts: string[],
): string {
  const context: string[] = [];
  if (activePrompt) {
    context.push(
      `Current prompt: ${activePrompt.title} (prompt ${activePrompt.id}, revision ${activePrompt.revisionId}).\n<prompt_markdown>\n${activePrompt.markdown}\n</prompt_markdown>`,
    );
  }
  context.push(...quoteContexts);
  return context.length ? `${context.join("\n\n")}\n\nUser request:\n${instruction}` : instruction;
}

function isTargetRunQuote(quote: ChatQuote): quote is TargetRunQuote {
  return "runId" in quote;
}

function formatTargetRunContext(run: StoredTargetRun): string {
  const trace = {
    createdAt: run.createdAt,
    id: run.id,
    prompt: {
      id: run.promptId,
      revisionId: run.promptRevisionId,
      revisionNumber: run.promptRevisionNumber,
      title: run.promptTitle,
    },
    runtime: {
      effectiveInstructionsHash: run.effectiveInstructionsHash,
      modelId: run.targetModel,
      profileId: run.targetProfileId,
      profileName: run.targetProfileName,
      profileRevisionId: run.targetProfileRevisionId,
      reasoningEffort: run.reasoningEffort,
    },
    source: run.source,
    turns: run.turns.map((turn) => ({
      activity: turn.activity,
      completedAt: turn.completedAt,
      createdAt: turn.createdAt,
      errorMessage: turn.errorMessage,
      id: turn.id,
      input: turn.input,
      output: turn.output,
      position: turn.position,
      status: turn.status,
      usage: turn.usage,
    })),
    updatedAt: run.updatedAt,
  };
  return `Quoted Target Run ${run.id}:\n<target_run_trace>\n${JSON.stringify(trace, null, 2)}\n</target_run_trace>`;
}
