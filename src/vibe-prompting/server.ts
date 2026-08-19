/** Publishes side-effect-free application services for server-only framework adapters. */

import { resolveModelIdentities } from "./clients/models-dev.ts";
import { loadRuntimeConfig } from "./config.ts";
import { ConversationRunRegistry } from "./conversations/runs.ts";
import { ConversationStore } from "./conversations/store.ts";
import { createDatabase } from "./database.ts";
import { EvaluationRuns } from "./evaluation/runs.ts";
import { configureModelSpendLimit } from "./model-spend-limit.ts";
import { PromptSearch } from "./prompts/search.ts";
import { PromptStore } from "./prompts/store.ts";

export type ConfiguredModel = {
  id: string;
  label: string;
  provider: string;
};

export type ApplicationServices = {
  close(): Promise<void>;
  conversations: ConversationStore;
  evaluations: EvaluationRuns;
  promptSearch: PromptSearch;
  prompts: PromptStore;
  runs: ConversationRunRegistry;
};

const sharedState = globalThis as typeof globalThis & {
  vibePromptingServicesVersion?: number;
  vibePromptingServices?: Promise<ApplicationServices>;
};
const APPLICATION_SERVICES_VERSION = 3;

export async function getConfiguredModels(): Promise<ConfiguredModel[]> {
  const { models } = loadRuntimeConfig();
  const identities = await resolveModelIdentities(models.map(({ id }) => id));
  return models.map(({ id }, index) => ({ id, ...identities[index] }));
}

export function isConfiguredModelId(id: string): boolean {
  return loadRuntimeConfig().models.some((model) => model.id === id);
}

export async function createApplicationServices(
  databaseUrl?: string,
): Promise<ApplicationServices> {
  const database = createDatabase(databaseUrl);
  await database.initialize();
  configureModelSpendLimit(database);
  const prompts = new PromptStore(database);
  const evaluations = new EvaluationRuns(database, prompts);
  return {
    close: () => database.close(),
    conversations: new ConversationStore(database),
    evaluations,
    promptSearch: new PromptSearch(database, prompts),
    prompts,
    runs: new ConversationRunRegistry(),
  };
}

export function getApplicationServices(): Promise<ApplicationServices> {
  if (
    !sharedState.vibePromptingServices ||
    sharedState.vibePromptingServicesVersion !== APPLICATION_SERVICES_VERSION
  ) {
    sharedState.vibePromptingServicesVersion = APPLICATION_SERVICES_VERSION;
    sharedState.vibePromptingServices = createApplicationServices().then(async (services) => {
      await services.evaluations.reconcileInterrupted();
      return services;
    });
  }
  return sharedState.vibePromptingServices;
}

export { CHAT_TOOL_IDS, streamChatRun, streamPromptEdit } from "./agent/runtime.ts";
export type {
  AgentStreamEvent,
  ChatAttachment,
  ChatReasoningEffort,
  ChatRunResult,
  ChatToolId,
  PromptEdit,
} from "./agent/runtime.ts";
export { EmbeddingError } from "./clients/embedding.ts";
export * from "./conversations/index.ts";
export * from "./evaluation/runs.ts";
export * from "./prompts/store.ts";
