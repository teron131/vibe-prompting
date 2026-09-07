/** Constructs one isolated application graph and owns recovery, execution shutdown, telemetry, accounting, and database disposal. */

import { AuthService } from "../auth/index.ts";
import { createModelContext, type ModelContext } from "../clients/llm/context.ts";
import { resolveModelIdentities } from "../clients/llm/models-dev.ts";
import { loadModelSpendLimits } from "../config/index.ts";
import { ConversationRunRegistry } from "../conversations/runs.ts";
import { ConversationStore } from "../conversations/store.ts";
import { CriterionLibrary } from "../criteria/index.ts";
import { Database } from "../database/index.ts";
import { createEvaluationEngine, type EvaluationEngine } from "../evaluation/engine/graph.ts";
import { EvaluationResults } from "../evaluation/results/index.ts";
import { EvaluationRuns } from "../evaluation/runs/index.ts";
import { PromptSystem } from "../prompt-system/index.ts";
import { ScenarioRuns } from "../scenarios/index.ts";
import { HybridSearch } from "../search.ts";
import { ApplicationSettingsStore } from "../settings/index.ts";
import { TargetSystem } from "../target/index.ts";
import { TargetRuns } from "../target/runs/index.ts";

export type ConfiguredModel = { id: string; provider: string; label: string; known: boolean };

export type ApplicationServices = {
  auth: AuthService;
  prompts: PromptSystem;
  targets: TargetSystem;
  targetRuns: TargetRuns;
  scenarios: ScenarioRuns;
  evaluations: EvaluationRuns;
  evaluationResults: EvaluationResults;
  criterion: CriterionLibrary;
  conversations: ConversationStore;
  runs: ConversationRunRegistry;
  settings: ApplicationSettingsStore;
  models: ModelContext;
  evaluator: EvaluationEngine;
  readonly closed: boolean;
  getConfiguredModels(): Promise<ConfiguredModel[]>;
  isConfiguredModelId(id: string): boolean;
  onClose(operation: () => Promise<void>): void;
  close(): Promise<void>;
};

/** Returns a ready application only after every durable owner has recovered and queue activation is safe. */
export async function createApplicationServices(
  databaseUrl?: string,
  options: { environment?: NodeJS.ProcessEnv } = {},
): Promise<ApplicationServices> {
  const environment = { ...(options.environment ?? process.env) };
  const database = new Database(databaseUrl ?? environment.DATABASE_URL, environment.DATABASE_HOST);
  let models: ModelContext | undefined;
  let evaluator: EvaluationEngine | undefined;
  let targetRuns: TargetRuns | undefined;
  let evaluations: EvaluationRuns | undefined;
  let scenarios: ScenarioRuns | undefined;
  let runs: ConversationRunRegistry | undefined;
  let closed = false;
  let closing: Promise<void> | undefined;
  const shutdownHooks: Array<() => Promise<void>> = [];

  const close = () =>
    (closing ??= (async () => {
      closed = true;
      const executionShutdown = [
        runs?.close(),
        scenarios?.close(),
        evaluations?.close(),
        targetRuns?.close(),
      ];
      models?.stop();
      const results = await Promise.allSettled([
        ...executionShutdown,
        ...shutdownHooks.map((operation) => Promise.resolve().then(operation)),
      ]);
      for (const resource of [evaluator, models, database]) {
        results.push(...(await Promise.allSettled([resource?.close()])));
      }
      const errors = results.flatMap((result) =>
        result.status === "rejected" ? [result.reason] : [],
      );
      if (errors.length) throw new AggregateError(errors, "Application shutdown failed.");
    })());

  try {
    await database.initialize();
    const settings = new ApplicationSettingsStore(database, environment);
    await settings.initialize();
    const modelContext = createModelContext(
      () => settings.getRuntimeConfig(),
      database,
      loadModelSpendLimits(environment),
    );
    models = modelContext;
    evaluator = createEvaluationEngine(modelContext, environment);
    const search = new HybridSearch(database, modelContext.readConfig);
    const prompts = new PromptSystem(database, search);
    const targets = new TargetSystem(database, prompts, modelContext);
    targetRuns = new TargetRuns(database, prompts, targets, modelContext);
    evaluations = new EvaluationRuns(
      database,
      prompts,
      targets,
      targetRuns,
      modelContext,
      evaluator,
    );
    scenarios = new ScenarioRuns(database, prompts, targetRuns, evaluations, modelContext);
    runs = new ConversationRunRegistry();
    const services: ApplicationServices = {
      auth: new AuthService(database),
      prompts,
      targets,
      targetRuns,
      scenarios,
      evaluations,
      evaluationResults: new EvaluationResults(database, search),
      criterion: new CriterionLibrary(database),
      conversations: new ConversationStore(database, search),
      runs,
      settings,
      models: modelContext,
      evaluator,
      get closed() {
        return closed;
      },
      async getConfiguredModels() {
        const { models } = modelContext.readConfig();
        const identities = await resolveModelIdentities(models.map(({ id }) => id));
        return models.map(({ id }, index) => ({ id, ...identities[index] }));
      },
      isConfiguredModelId: (id) =>
        modelContext.readConfig().models.some((model) => model.id === id),
      onClose(operation) {
        if (closed) throw new Error("Application runtime is closed.");
        shutdownHooks.push(operation);
      },
      close,
    };
    await evaluations.reconcileInterrupted();
    await targetRuns.reconcileInterrupted();
    await scenarios.reconcileInterrupted();
    evaluations.start();
    scenarios.start();
    return services;
  } catch (error) {
    try {
      await close();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "Application initialization and cleanup failed.",
        { cause: error },
      );
    }
    throw error;
  }
}
