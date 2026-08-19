/** Publishes side-effect-free application services for server-only framework adapters. */

import { resolveModelIdentities } from "./clients/models-dev.ts";
import { loadRuntimeConfig } from "./config.ts";
import { ConversationRunRegistry } from "./conversations/runs.ts";
import { ConversationStore } from "./conversations/store.ts";
import { createDatabase } from "./database.ts";
import { EvaluationRuns } from "./evaluation/runs.ts";
import { configureModelSpendLimit } from "./model-spend-limit.ts";
import { PromptSystem } from "./prompt-system/index.ts";
import { ApplicationSettingsStore } from "./settings/index.ts";

export type ConfiguredModel = {
  id: string;
  known: boolean;
  label: string;
  provider: string;
};

export type ApplicationServices = {
  close(): Promise<void>;
  conversations: ConversationStore;
  evaluations: EvaluationRuns;
  prompts: PromptSystem;
  runs: ConversationRunRegistry;
  settings: ApplicationSettingsStore;
};

const sharedState = globalThis as typeof globalThis & {
  vibePromptingServicesVersion?: number;
  vibePromptingServices?: Promise<ApplicationServices>;
};
const APPLICATION_SERVICES_VERSION = 5;

export async function getConfiguredModels(): Promise<ConfiguredModel[]> {
  await getApplicationServices();
  const { models } = loadRuntimeConfig();
  const identities = await resolveModelIdentities(models.map(({ id }) => id));
  return models.map(({ id }, index) => ({ id, ...identities[index] }));
}

export async function getModelIdentity(id: string): Promise<ConfiguredModel> {
  const [identity] = await resolveModelIdentities([id]);
  return { id, ...identity };
}

export async function isConfiguredModelId(id: string): Promise<boolean> {
  await getApplicationServices();
  return loadRuntimeConfig().models.some((model) => model.id === id);
}

export async function createApplicationServices(
  databaseUrl?: string,
): Promise<ApplicationServices> {
  const database = createDatabase(databaseUrl);
  await database.initialize();
  const settings = new ApplicationSettingsStore(database);
  await settings.initialize();
  configureModelSpendLimit(database);
  const prompts = new PromptSystem(database);
  const evaluations = new EvaluationRuns(database, prompts);
  return {
    close: () => database.close(),
    conversations: new ConversationStore(database),
    evaluations,
    prompts,
    runs: new ConversationRunRegistry(),
    settings,
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
export * from "./prompt-system/index.ts";
export * from "./settings/index.ts";
