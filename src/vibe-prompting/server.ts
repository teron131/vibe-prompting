/** Publishes side-effect-free application services for server-only framework adapters. */

import { resolveModelIdentities } from "./clients/llm/models-dev.ts";
import { configureSpendLimit } from "./clients/llm/spend.ts";
import { loadModelSpendLimits, loadRuntimeConfig } from "./config/index.ts";
import { ConversationRunRegistry } from "./conversations/runs.ts";
import { ConversationStore } from "./conversations/store.ts";
import { createDatabase } from "./database.ts";
import { CriteriaProfiles } from "./evaluation/criteria-profiles.ts";
import { ensureEvaluationDemo } from "./evaluation/demo.ts";
import { EvaluationResults } from "./evaluation/results/index.ts";
import { EvaluationRuns } from "./evaluation/runs/index.ts";
import { PromptSystem } from "./prompt-system/index.ts";
import { HybridSearch } from "./search.ts";
import { ApplicationSettingsStore } from "./settings/index.ts";
import { TargetSystem } from "./target/index.ts";
import { TargetRuns } from "./target/runs/index.ts";

export type ConfiguredModel = {
  id: string;
  provider: string;
  label: string;
  known: boolean;
};

export type ApplicationServices = {
  prompts: PromptSystem;
  targets: TargetSystem;
  targetRuns: TargetRuns;
  evaluations: EvaluationRuns;
  evaluationResults: EvaluationResults;
  criteriaProfiles: CriteriaProfiles;
  conversations: ConversationStore;
  runs: ConversationRunRegistry;
  settings: ApplicationSettingsStore;
  close(): Promise<void>;
};

const sharedState = globalThis as typeof globalThis & {
  vibePromptingServicesVersion?: number;
  vibePromptingServices?: Promise<ApplicationServices>;
};
const APPLICATION_SERVICES_VERSION = 24;

/** Resolves configured model identities after the shared services and database are ready. */
export async function getConfiguredModels(): Promise<ConfiguredModel[]> {
  await getApplicationServices();
  const { models } = loadRuntimeConfig();
  const identities = await resolveModelIdentities(models.map(({ id }) => id));
  return models.map(({ id }, index) => ({ id, ...identities[index] }));
}

/** Resolves one model identity without changing the configured model catalogue. */
export async function getModelIdentity(id: string): Promise<ConfiguredModel> {
  const [identity] = await resolveModelIdentities([id]);
  return { id, ...identity };
}

/** Checks only user-configured target models, excluding the helper model. */
export async function isConfiguredModelId(id: string): Promise<boolean> {
  await getApplicationServices();
  return loadRuntimeConfig().models.some((model) => model.id === id);
}

/** Builds the application graph with one database, search policy, and lifecycle owner per process. */
export async function createApplicationServices(
  databaseUrl?: string,
): Promise<ApplicationServices> {
  const database = createDatabase(databaseUrl);
  await database.initialize();
  await ensureEvaluationDemo(database);
  const settings = new ApplicationSettingsStore(database);
  await settings.initialize();
  configureSpendLimit(database, loadModelSpendLimits());
  const search = new HybridSearch(database);
  const prompts = new PromptSystem(database, search);
  const targets = new TargetSystem(database, prompts);
  const targetRuns = new TargetRuns(database, prompts, targets);
  const evaluations = new EvaluationRuns(database, prompts, targets, targetRuns);
  const criteriaProfiles = new CriteriaProfiles(database);
  return {
    prompts,
    targets,
    targetRuns,
    evaluations,
    evaluationResults: new EvaluationResults(database, search),
    criteriaProfiles,
    conversations: new ConversationStore(database, search),
    runs: new ConversationRunRegistry(),
    settings,
    close: () => database.close(),
  };
}

/** Returns the process-shared services and reconciles interrupted durable evaluations once. */
export function getApplicationServices(): Promise<ApplicationServices> {
  if (
    !sharedState.vibePromptingServices ||
    sharedState.vibePromptingServicesVersion !== APPLICATION_SERVICES_VERSION
  ) {
    sharedState.vibePromptingServicesVersion = APPLICATION_SERVICES_VERSION;
    sharedState.vibePromptingServices = createApplicationServices().then(async (services) => {
      await services.evaluations.reconcileInterrupted();
      await services.targetRuns.reconcileInterrupted();
      return services;
    });
  }
  return sharedState.vibePromptingServices;
}

export { CHAT_TOOL_IDS, streamChatRun, streamPromptEdit } from "./agents/openai-agents/runtime.ts";
export type {
  AgentStreamEvent,
  ChatAttachment,
  ChatReasoningEffort,
  ChatRunResult,
  ChatToolId,
  PromptEdit,
} from "./agents/openai-agents/runtime.ts";
export { EmbeddingError } from "./clients/embedding.ts";
export * from "./conversations/index.ts";
export * from "./evaluation/runs/index.ts";
export * from "./evaluation/results/index.ts";
export * from "./evaluation/criteria-profiles.ts";
export * from "./prompt-system/index.ts";
export * from "./settings/index.ts";
export * from "./target/index.ts";
export * from "./target/runs/index.ts";
