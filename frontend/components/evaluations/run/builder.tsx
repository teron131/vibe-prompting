/** Owns the human Scenario-run setup experience while delegating workflow execution and evaluation handoff to the Scenario API. */

"use client";

import {
  ChevronRight,
  LoaderCircle,
  Plus,
  RotateCcw,
  Save,
  SlidersHorizontal,
  Trash2,
  X,
} from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { type CSSProperties, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { ModelIdentityLabel } from "@/components/chat/model-selector";
import { CriteriaPicker, EvaluationModelPicker } from "@/components/evaluations/run/selectors";
import { EvaluationPageBar } from "@/components/evaluations/shared/evaluation-page-bar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { maximumResizablePanelWidth, ResizableDivider } from "@/components/ui/resizable-divider";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/components/ui/utils";
import type { ConfiguredModel, ConfiguredModelsResponse } from "@/contracts/chat";
import type {
  Criteria,
  CriteriaListResponse,
  EvaluationBatchConfiguration,
} from "@/contracts/evaluations";
import type { PromptsResponse, PromptSummary } from "@/contracts/prompts";
import {
  isScenarioActive,
  isScenarioEvaluationActive,
  type ScenarioRunResponse,
} from "@/contracts/scenario-runs";
import type { TargetProfile, TargetProfileResponse } from "@/contracts/targets";
import { createApiRequester, createErrorReader } from "@/shared/api";

const RecordedEvaluationBuilder = dynamic(() =>
  import("./recorded").then(({ RecordedEvaluationBuilder }) => RecordedEvaluationBuilder),
);

type SavedConfiguration = {
  name: string;
  targetModels: string[];
  judgeModels: string[];
  configurationIds: string[];
  scenarioMode: ScenarioMode;
  scenarios: ScenarioDraft[];
  driverModel: string;
  repetitions: number;
};

type LastRunConfiguration = Omit<SavedConfiguration, "name"> & { promptId: string };

type ScenarioMode = "generative" | "static";

type ScenarioDraft = {
  instruction: string;
  maxTurns: number;
  messages: string[];
};

type TrackedScenarioBatch = {
  signature: string;
  runIds: string[];
};

const STORAGE_KEY = "vibe-prompting.scenario-configurations.v4";
const LAST_RUN_STORAGE_KEY = "vibe-prompting.scenario-run.v4";
const TRACKED_SCENARIO_STORAGE_KEY = "vibe-prompting.scenario-batch.v1";
const evaluationApi = createApiRequester({}, (status) => `Request failed with ${status}.`);
const readError = createErrorReader("The evaluation request failed.");
const MANIFEST_MIN_WIDTH = 256;
const MANIFEST_MAX_WIDTH = 560;
const RUN_FORM_MIN_WIDTH = 440;
const MAX_SCENARIOS = 10;
const DEFAULT_SCENARIO: ScenarioDraft = { instruction: "", maxTurns: 5, messages: [""] };

export function EvaluationRunBuilder({
  targetRunId,
  targetRunTurnId,
}: {
  targetRunId?: string;
  targetRunTurnId?: string;
} = {}) {
  if (targetRunId && targetRunTurnId) {
    return (
      <RecordedEvaluationBuilder targetRunId={targetRunId} targetRunTurnId={targetRunTurnId} />
    );
  }
  return <EvaluationScenarioRunBuilder />;
}

function EvaluationScenarioRunBuilder() {
  const [prompts, setPrompts] = useState<PromptSummary[]>([]);
  const [models, setModels] = useState<ConfiguredModel[]>([]);
  const [criteria, setCriteria] = useState<Criteria[]>([]);
  const [promptId, setPromptId] = useState("");
  const [targetProfile, setTargetProfile] = useState<TargetProfile | null>();
  const [targetModels, setTargetModels] = useState<string[]>([]);
  const [judgeModels, setJudgeModels] = useState<string[]>([]);
  const [configurationIds, setConfigurationIds] = useState<string[]>([]);
  const [repetitions, setRepetitions] = useState(3);
  const [scenarioMode, setScenarioMode] = useState<ScenarioMode>("static");
  const [scenarios, setScenarios] = useState<ScenarioDraft[]>([createScenarioDraft()]);
  const [driverModel, setDriverModel] = useState("");
  const [running, setRunning] = useState(false);
  const [savedConfigurations, setSavedConfigurations] = useState<SavedConfiguration[]>([]);
  const [savedName, setSavedName] = useState("");
  const [runStateReady, setRunStateReady] = useState(false);
  const [trackedScenarioBatch, setTrackedScenarioBatch] = useState<TrackedScenarioBatch | null>(
    null,
  );
  const [startedScenarios, setStartedScenarios] = useState<ScenarioRunResponse[]>([]);
  const [scenarioStatusError, setScenarioStatusError] = useState<string>();
  const [scenarioRetry, setScenarioRetry] = useState(0);
  const [manifestWidth, setManifestWidth] = useState<number>();
  const workspaceRef = useRef<HTMLDivElement>(null);
  const manifestRef = useRef<HTMLElement>(null);
  const trackedScenarioIds = trackedScenarioBatch?.runIds.join(",") ?? "";
  const selectedPrompt = prompts.find(({ id }) => id === promptId);

  useEffect(() => {
    Promise.all([
      evaluationApi.json<ConfiguredModelsResponse>("/api/config"),
      evaluationApi.json<PromptsResponse>("/api/prompts"),
      evaluationApi.json<CriteriaListResponse>("/api/evaluations/criteria"),
    ])
      .then(([config, promptData, criteriaData]) => {
        const lastRun = readLastRunConfiguration();
        const lastScenarioBatch = readTrackedScenarioBatch();
        setModels(config.models);
        setCriteria(criteriaData.criteria);
        setPrompts(promptData.prompts);
        setPromptId(
          lastRun && promptData.prompts.some(({ id }) => id === lastRun.promptId)
            ? lastRun.promptId
            : "",
        );
        setTargetModels(restoreSelection(lastRun?.targetModels, config.models, []));
        setJudgeModels(restoreSelection(lastRun?.judgeModels, config.models, []));
        setConfigurationIds(restoreSelection(lastRun?.configurationIds, criteriaData.criteria, []));
        if (lastRun) {
          setScenarioMode(lastRun.scenarioMode);
          setDriverModel(
            config.models.some(({ id }) => id === lastRun.driverModel) ? lastRun.driverModel : "",
          );
          setRepetitions(lastRun.repetitions);
          setScenarios(normalizeScenarios(lastRun.scenarios, lastRun.scenarioMode));
        }
        if (lastScenarioBatch) setTrackedScenarioBatch(lastScenarioBatch);
        setRunStateReady(true);
      })
      .catch((error) => toast.error(readError(error)));
    setSavedConfigurations(readSavedConfigurations());
  }, []);

  useEffect(() => {
    if (!runStateReady) return;
    const lastRun: LastRunConfiguration = {
      promptId,
      targetModels,
      judgeModels,
      configurationIds,
      scenarioMode,
      scenarios: scenarios
        .filter((scenario) => hasScenarioContent(scenario, scenarioMode))
        .slice(0, MAX_SCENARIOS),
      driverModel,
      repetitions,
    };
    window.localStorage.setItem(LAST_RUN_STORAGE_KEY, JSON.stringify(lastRun));
  }, [
    configurationIds,
    driverModel,
    judgeModels,
    promptId,
    repetitions,
    runStateReady,
    scenarioMode,
    scenarios,
    targetModels,
  ]);

  useEffect(() => {
    if (!promptId) return setTargetProfile(undefined);
    setTargetProfile(undefined);
    let active = true;
    void evaluationApi
      .json<TargetProfileResponse>(`/api/targets?promptId=${encodeURIComponent(promptId)}`)
      .then(({ profile }) => {
        if (active) setTargetProfile(profile);
      })
      .catch((error) => {
        if (active) toast.error(readError(error));
      });
    return () => {
      active = false;
    };
  }, [promptId]);

  useEffect(() => {
    if (!trackedScenarioIds) {
      setStartedScenarios([]);
      setScenarioStatusError(undefined);
      return;
    }
    setScenarioStatusError(undefined);
    let active = true;
    let polling = false;
    let timer: number | undefined;
    const intervalMs = 1500;
    const runIds = trackedScenarioIds.split(",");
    const schedule = (delay = intervalMs) => {
      if (!active || document.hidden) return;
      timer = window.setTimeout(() => {
        timer = undefined;
        void refresh();
      }, delay);
    };
    const refresh = async () => {
      if (polling || document.hidden) return;
      polling = true;
      const startedAt = performance.now();
      try {
        const responses = await mapWithConcurrency(runIds, 6, (runId) =>
          evaluationApi.json<ScenarioRunResponse>(`/api/scenario-runs/${runId}`),
        );
        if (!active) return;
        setStartedScenarios(responses);
        setScenarioStatusError(undefined);
        if (
          responses.some(
            (response) => isScenarioActive(response) || isScenarioEvaluationActive(response),
          )
        ) {
          schedule(Math.max(0, intervalMs - (performance.now() - startedAt)));
        }
      } catch (error) {
        if (active) setScenarioStatusError(readError(error));
      } finally {
        polling = false;
      }
    };
    const handleVisibilityChange = () => {
      if (document.hidden) {
        if (timer !== undefined) window.clearTimeout(timer);
        timer = undefined;
        return;
      }
      if (polling || timer !== undefined) return;
      void refresh();
    };
    if (!document.hidden) void refresh();
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      active = false;
      if (timer !== undefined) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [scenarioRetry, trackedScenarioIds]);

  async function startScenarioBatch() {
    if (!selectedPrompt) return;
    const matrix = buildScenarioMatrix({
      prompt: selectedPrompt,
      targetModels,
      judgeModels,
      criteria,
      configurationIds,
      scenarioMode,
      scenarios,
      driverModel,
      repetitions,
    });
    if (matrix.requests.length === 0) return;
    setRunning(true);
    try {
      const settled = await mapWithConcurrency(matrix.requests, 4, async (body) => {
        try {
          return {
            response: await evaluationApi.json<ScenarioRunResponse>("/api/scenario-runs", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(body),
            }),
          };
        } catch (error) {
          return { error };
        }
      });
      const responses = settled.flatMap((value) => (value.response ? [value.response] : []));
      const failures = settled.length - responses.length;
      if (responses.length === 0) throw settled[0]?.error;
      const nextTrackedBatch = {
        signature: matrix.signature,
        runIds: responses.map(({ scenario }) => scenario.id),
      };
      setStartedScenarios(responses);
      setScenarioStatusError(undefined);
      setTrackedScenarioBatch(nextTrackedBatch);
      window.localStorage.setItem(TRACKED_SCENARIO_STORAGE_KEY, JSON.stringify(nextTrackedBatch));
      toast.success(
        failures
          ? `Started ${responses.length} Scenario Runs; ${failures} could not be queued.`
          : `Started ${responses.length} Scenario Runs.`,
      );
    } catch (error) {
      toast.error(readError(error));
    } finally {
      setRunning(false);
    }
  }

  function dismissScenarioBatch() {
    window.localStorage.removeItem(TRACKED_SCENARIO_STORAGE_KEY);
    setTrackedScenarioBatch(null);
    setStartedScenarios([]);
    setScenarioStatusError(undefined);
  }

  function saveConfiguration() {
    const name = savedName.trim();
    if (!name) return toast.error("Name this setup before saving it.");
    const completeScenarios = scenarios
      .filter((scenario) => hasScenarioContent(scenario, scenarioMode))
      .slice(0, MAX_SCENARIOS);
    if (completeScenarios.length === 0)
      return toast.error("Add at least one Scenario before saving it.");
    const replaced = savedConfigurations.some((configuration) => configuration.name === name);
    const next = [
      ...savedConfigurations.filter((configuration) => configuration.name !== name),
      {
        name,
        targetModels,
        judgeModels,
        configurationIds,
        scenarioMode,
        scenarios: completeScenarios,
        driverModel,
        repetitions,
      },
    ];
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    setSavedConfigurations(next);
    setScenarios(completeScenarios);
    setSavedName("");
    toast.success(
      replaced ? `Replaced “${name}” in this browser.` : `Saved “${name}” in this browser.`,
    );
  }

  function loadConfiguration(value: string) {
    const saved = savedConfigurations.find(({ name }) => name === value);
    if (!saved) return;
    setScenarioMode(saved.scenarioMode);
    setConfigurationIds(
      saved.configurationIds.filter((id) => criteria.some((value) => value.id === id)),
    );
    setJudgeModels(saved.judgeModels.filter((id) => models.some((model) => model.id === id)));
    setDriverModel(models.some(({ id }) => id === saved.driverModel) ? saved.driverModel : "");
    setRepetitions(saved.repetitions);
    setScenarios(normalizeScenarios(saved.scenarios, saved.scenarioMode));
    setTargetModels(saved.targetModels.filter((id) => models.some((model) => model.id === id)));
  }

  const completeScenarioCount = scenarios.filter((scenario) =>
    hasScenarioContent(scenario, scenarioMode),
  ).length;
  const scenariosReady =
    completeScenarioCount === scenarios.length &&
    (scenarioMode !== "static" ||
      scenarios.every(
        ({ messages }) =>
          messages.length > 0 &&
          messages.length <= 10 &&
          messages.every((message) => message.trim()),
      ));
  const setupRequirements = getSetupRequirements({
    promptId,
    selectedPrompt,
    targetModels,
    judgeModels,
    configurationIds,
    scenarioMode,
    scenarioCount: completeScenarioCount,
    draftScenarioCount: scenarios.length,
    scenariosReady,
    repetitions,
  });
  const canAddScenario = scenarios.length < MAX_SCENARIOS;
  const selectedCriteria = criteria.filter(({ id }) => configurationIds.includes(id));
  const scenarioMatrix = selectedPrompt
    ? buildScenarioMatrix({
        prompt: selectedPrompt,
        targetModels,
        judgeModels,
        criteria,
        configurationIds,
        scenarioMode,
        scenarios,
        driverModel,
        repetitions,
      })
    : null;
  const scenarioRunCount = scenarioMatrix?.requests.length ?? 0;
  const trackedScenarioCount = trackedScenarioBatch?.runIds.length ?? 0;
  const finishedScenarios = startedScenarios.filter(
    (response) => !isScenarioActive(response) && !isScenarioEvaluationActive(response),
  ).length;
  const scenarioProgress = trackedScenarioCount
    ? Math.round((finishedScenarios / trackedScenarioCount) * 100)
    : 0;
  const scenariosRunning = trackedScenarioCount > 0 && finishedScenarios < trackedScenarioCount;
  const tracksCurrentScenarioSetup = Boolean(
    scenarioMatrix && trackedScenarioBatch?.signature === scenarioMatrix.signature,
  );
  const executionCount = scenarioRunCount;
  const targetOutputCount = scenarioRunCount;
  const judgeDecisionCount =
    scenarioRunCount *
    judgeModels.length *
    selectedCriteria.reduce((total, value) => total + value.criterionSequence.length, 0);
  const setupReady = setupRequirements.every(({ ready }) => ready);
  const maximumManifestWidth = () => {
    return maximumResizablePanelWidth({
      contentMinWidth: RUN_FORM_MIN_WIDTH,
      maxWidth: MANIFEST_MAX_WIDTH,
      minWidth: MANIFEST_MIN_WIDTH,
      workspace: workspaceRef.current,
    });
  };

  return (
    <div
      className="mx-auto grid min-h-[calc(100dvh-var(--header-height))] w-full max-w-[1480px] grid-cols-1 @min-[720px]:grid-cols-[minmax(0,1fr)_1px_var(--run-manifest-width)] @min-[720px]:[--run-manifest-width:18rem] @min-[900px]:[--run-manifest-width:20rem] @min-[1200px]:[--run-manifest-width:25rem]"
      ref={workspaceRef}
      style={
        manifestWidth === undefined
          ? undefined
          : ({ "--run-manifest-width": `${manifestWidth}px` } as CSSProperties)
      }
    >
      <section className="min-w-0 bg-background">
        <EvaluationPageBar sticky>
          <h1 className="shrink-0 text-base font-semibold tracking-tight">Evaluation Run</h1>
          <p className="hidden min-w-0 flex-1 truncate text-xs text-muted-foreground @min-[920px]:block">
            Configure prompt, models, criteria, Scenarios, and repetitions.
          </p>
          <p className="ml-auto shrink-0 font-mono text-[11px] uppercase text-muted-foreground">
            {count(completeScenarioCount, "Scenario")} · {repetitions}×
          </p>
        </EvaluationPageBar>

        <div className="px-4 pb-12 sm:px-6 min-[840px]:px-7 xl:px-10">
          <RunSection
            description="Choose the prompt revision, target models that answer, and judge models that score."
            title="Prompt and Models"
          >
            <div className="grid gap-4 @min-[980px]:grid-cols-[minmax(18rem,1fr)_minmax(16rem,0.8fr)]">
              <Field label="Prompt Revision">
                <Select onValueChange={setPromptId} value={promptId}>
                  <option value="">Choose a prompt revision</option>
                  {prompts.map((prompt) => (
                    <option key={prompt.id} value={prompt.id}>
                      {prompt.title} · v{prompt.revisionNumber}
                    </option>
                  ))}
                </Select>
              </Field>
              <dl className="grid grid-cols-2 divide-x border-y text-xs">
                <Definition
                  label="Agent Setup"
                  value={
                    !promptId
                      ? "Choose a prompt"
                      : targetProfile === undefined
                        ? "Loading…"
                        : (targetProfile?.name ?? "AI SDK agent")
                  }
                />
                <Definition
                  label="Runtime"
                  value={
                    !promptId
                      ? "—"
                      : targetProfile
                        ? `${targetProfile.configuration.maxSteps ?? "Default"} steps · ${targetProfile.configuration.tools?.length ? targetProfile.configuration.tools.join(", ") : "no tools"}`
                        : "AI SDK defaults"
                  }
                />
              </dl>
            </div>
            <EvaluationModelPicker
              className="mt-4"
              label="Target Models"
              models={models}
              onChange={setTargetModels}
              selected={targetModels}
            />
            <EvaluationModelPicker
              className="mt-4"
              label="Judge Models"
              models={models}
              onChange={setJudgeModels}
              selected={judgeModels}
            />
          </RunSection>

          <RunSection
            description="Choose reusable Criteria; each evaluation preserves its Criterion order."
            title="Criteria"
          >
            <CriteriaPicker
              actions={
                <div className="flex items-center gap-3 text-xs">
                  <button
                    className="text-muted-foreground hover:text-foreground"
                    onClick={() => setConfigurationIds(criteria.map(({ id }) => id))}
                    type="button"
                  >
                    Select all
                  </button>
                  <button
                    className="text-muted-foreground hover:text-foreground"
                    onClick={() => setConfigurationIds([])}
                    type="button"
                  >
                    Clear
                  </button>
                  <Link
                    className="inline-flex items-center gap-1.5 font-medium hover:underline"
                    href="/evaluations/criterion"
                  >
                    <SlidersHorizontal className="size-3.5" /> Manage
                  </Link>
                </div>
              }
              onChange={setConfigurationIds}
              criteria={criteria}
              selected={configurationIds}
            />
          </RunSection>

          <RunSection
            action={
              <Button
                disabled={!canAddScenario}
                onClick={() => {
                  if (!canAddScenario) return;
                  setScenarios([...scenarios, createScenarioDraft()]);
                }}
                size="sm"
                variant="outline"
              >
                <Plus className="size-3.5" /> Add Scenario
              </Button>
            }
            description={
              scenarioMode === "generative"
                ? "The Instruction will be sent to an extra agent to role play the user messages accordingly."
                : "Build an ordered conversation with one box per user message. One message is a one-turn Static Scenario."
            }
            title="Scenarios"
          >
            <div
              aria-label="Scenario mode"
              className="mb-4 inline-flex rounded-lg border bg-muted/25 p-1"
              role="group"
            >
              {(
                [
                  ["static", "Static Scenario"],
                  ["generative", "Generative Scenario"],
                ] as const
              ).map(([mode, label]) => (
                <button
                  aria-pressed={scenarioMode === mode}
                  className={cn(
                    "rounded-md px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    scenarioMode === mode
                      ? "bg-foreground text-background"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                  key={mode}
                  onClick={() => setScenarioMode(mode)}
                  type="button"
                >
                  {label}
                </button>
              ))}
            </div>

            {scenarioMode === "generative" ? (
              <DriverModelPicker
                className="mb-4"
                models={models}
                onChange={setDriverModel}
                selected={driverModel}
              />
            ) : null}

            <div className="overflow-hidden border-t">
              <div
                className={cn(
                  "grid items-center bg-muted/40 text-[11px] uppercase text-muted-foreground",
                  scenarioMode === "generative"
                    ? "grid-cols-[5.75rem_minmax(0,1fr)_7rem_2.75rem]"
                    : "grid-cols-[5.75rem_minmax(0,1fr)_2.75rem]",
                )}
              >
                <span className="px-3 py-2 font-mono">Scenario</span>
                <span className="px-3 py-2 font-mono">
                  {scenarioMode === "generative" ? "Instruction" : "Messages"}
                </span>
                {scenarioMode === "generative" ? (
                  <span className="px-2 py-2 font-mono">Max turns</span>
                ) : null}
                <span className="sr-only">Actions</span>
              </div>
              <div className="divide-y">
                {scenarios.map((scenario, index) => (
                  <div
                    className={cn(
                      "grid items-start",
                      scenarioMode === "generative"
                        ? "grid-cols-[5.75rem_minmax(0,1fr)_7rem_2.75rem]"
                        : "grid-cols-[5.75rem_minmax(0,1fr)_2.75rem]",
                    )}
                    key={index}
                  >
                    <span className="px-3 py-3 font-mono text-[11px] text-muted-foreground">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    {scenarioMode === "generative" ? (
                      <Textarea
                        aria-label={`Scenario ${index + 1} Instruction`}
                        className="my-2 min-h-20 rounded-none border-0 px-3 shadow-none focus-visible:ring-1"
                        onChange={(event) =>
                          setScenarios(
                            scenarios.map((item, itemIndex) =>
                              itemIndex === index
                                ? { ...item, instruction: event.target.value }
                                : item,
                            ),
                          )
                        }
                        placeholder="Describe how the agent should role-play the user"
                        value={scenario.instruction}
                      />
                    ) : (
                      <ScenarioMessagesEditor
                        messages={scenario.messages}
                        onChange={(messages) =>
                          setScenarios((current) =>
                            current.map((item, itemIndex) =>
                              itemIndex === index ? { ...item, messages } : item,
                            ),
                          )
                        }
                        scenarioNumber={index + 1}
                      />
                    )}
                    {scenarioMode === "generative" ? (
                      <div className="px-2 py-2">
                        <Input
                          aria-label={`Scenario ${index + 1} maximum turns`}
                          className="!h-8 !w-full px-2 text-xs shadow-none"
                          max={10}
                          min={1}
                          onChange={(event) =>
                            setScenarios(
                              scenarios.map((item, itemIndex) =>
                                itemIndex === index
                                  ? {
                                      ...item,
                                      maxTurns: Math.max(
                                        1,
                                        Math.min(10, Number(event.target.value) || 1),
                                      ),
                                    }
                                  : item,
                              ),
                            )
                          }
                          type="number"
                          value={scenario.maxTurns}
                        />
                      </div>
                    ) : null}
                    <Button
                      aria-label={`Remove Scenario ${index + 1}`}
                      className="mt-2 text-muted-foreground hover:text-destructive"
                      disabled={scenarios.length === 1}
                      onClick={() =>
                        setScenarios((current) =>
                          current.length > 1
                            ? current.filter((_, itemIndex) => itemIndex !== index)
                            : current,
                        )
                      }
                      size="icon"
                      variant="ghost"
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          </RunSection>

          <RunSection
            description="Set repetitions and save or reuse this browser's setup."
            title="Run Options"
          >
            <div className="grid gap-4 @min-[560px]:grid-cols-[8rem_minmax(12rem,1fr)] @min-[1040px]:grid-cols-[8rem_minmax(12rem,0.8fr)_minmax(14rem,1fr)]">
              <Field label="Repetitions">
                <Input
                  max={5}
                  min={1}
                  onChange={(event) =>
                    setRepetitions(Math.max(1, Math.min(5, Number(event.target.value) || 1)))
                  }
                  type="number"
                  value={repetitions}
                />
              </Field>
              <Field label="Load Setup">
                <Select defaultValue="" onValueChange={loadConfiguration}>
                  <option disabled value="">
                    Saved setups…
                  </option>
                  {savedConfigurations.map(({ name }) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="@min-[560px]:col-span-2 @min-[1040px]:col-span-1">
                <Field label="Save Current Setup">
                  <div className="flex gap-2">
                    <Input
                      onChange={(event) => setSavedName(event.target.value)}
                      placeholder="Setup name"
                      value={savedName}
                    />
                    <Button aria-label="Save setup" onClick={saveConfiguration} size="icon">
                      <Save className="size-3.5" />
                    </Button>
                  </div>
                </Field>
              </div>
            </div>
          </RunSection>
        </div>
      </section>

      <ResizableDivider
        ariaLabel="Resize execution manifest"
        className="hidden @min-[720px]:block"
        defaultValueText="Default execution manifest width"
        maxSize={maximumManifestWidth}
        minSize={MANIFEST_MIN_WIDTH}
        onSizeChange={setManifestWidth}
        panelRef={manifestRef}
        panelSide="right"
        size={manifestWidth}
      />

      <aside className="border-t bg-muted/15 @min-[720px]:border-t-0" ref={manifestRef}>
        <div className="flex min-h-[calc(100dvh-var(--header-height))] flex-col @min-[720px]:sticky @min-[720px]:top-0 @min-[720px]:max-h-[calc(100dvh-var(--header-height))] @min-[720px]:overflow-y-auto">
          <EvaluationPageBar className="shrink-0" inset="panel">
            <h2 className="text-sm font-semibold">Execution Manifest</h2>
          </EvaluationPageBar>
          <div className="flex min-h-0 flex-1 flex-col px-4 py-4 sm:px-5">
            {trackedScenarioBatch ? (
              <ScenarioBatchMonitor
                runs={startedScenarios}
                totalRuns={trackedScenarioCount}
                finishedRuns={finishedScenarios}
                progress={scenarioProgress}
                error={scenarioStatusError}
                tracksCurrentSetup={tracksCurrentScenarioSetup}
                retry={() => setScenarioRetry((current) => current + 1)}
                dismiss={dismissScenarioBatch}
              />
            ) : null}
            <div>
              <p className="pb-3 text-xs font-medium">Setup Readiness</p>
              <div className="border-y">
                <div className="grid grid-cols-[6.75rem_minmax(0,1fr)] gap-3 bg-muted/40 px-2 py-2 font-mono text-[10px] uppercase text-muted-foreground">
                  <span>Requirement</span>
                  <span className="text-right">Status</span>
                </div>
                <div className="divide-y">
                  {setupRequirements.map((requirement) => (
                    <div
                      className="grid grid-cols-[6.75rem_minmax(0,1fr)] items-center gap-3 px-2 py-2.5 text-xs"
                      key={requirement.label}
                    >
                      <span className="font-medium">{requirement.label}</span>
                      <div
                        className={cn(
                          "min-w-0 text-right",
                          requirement.ready ? "text-foreground" : "text-muted-foreground",
                        )}
                      >
                        {requirement.models?.length ? (
                          <div className="flex min-w-0 flex-col items-end gap-1">
                            {requirement.models.map((modelId) => (
                              <ModelIdentityLabel
                                className="max-w-full"
                                key={modelId}
                                labelClassName="truncate"
                                model={models.find(({ id }) => id === modelId)}
                                modelId={modelId}
                              />
                            ))}
                          </div>
                        ) : (
                          <span className="block truncate">{requirement.value}</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-3 border-y">
              <ManifestFact label="Executions" value={executionCount} />
              <ManifestFact label="Outputs" value={targetOutputCount} />
              <ManifestFact label="Decisions" value={judgeDecisionCount} />
            </div>
            <WorkloadCalculation
              scenarios={completeScenarioCount}
              criteriaCount={selectedCriteria.length}
              executions={executionCount}
              outputs={targetOutputCount}
              repetitions={repetitions}
              targets={targetModels.length}
            />
            <Button
              className="mt-4 w-full"
              disabled={running || !setupReady || scenariosRunning}
              onClick={startScenarioBatch}
            >
              {running ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : scenariosRunning ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : finishedScenarios === trackedScenarioCount && tracksCurrentScenarioSetup ? (
                <RotateCcw className="size-4" />
              ) : null}
              {running
                ? "Starting matrix…"
                : scenariosRunning
                  ? `${finishedScenarios} of ${trackedScenarioCount} finished`
                  : finishedScenarios === trackedScenarioCount && tracksCurrentScenarioSetup
                    ? "Run Scenario matrix again"
                    : setupReady
                      ? `Run ${scenarioRunCount} Scenarios`
                      : "Run Scenario evaluation"}
            </Button>
          </div>
        </div>
      </aside>
    </div>
  );
}

/** Reports durable Scenario generation and its automatic recorded-evaluation handoff as one batch. */
function ScenarioBatchMonitor({
  runs,
  totalRuns,
  finishedRuns,
  progress,
  error,
  tracksCurrentSetup,
  retry,
  dismiss,
}: {
  runs: ScenarioRunResponse[];
  totalRuns: number;
  finishedRuns: number;
  progress: number;
  error?: string;
  tracksCurrentSetup: boolean;
  retry(): void;
  dismiss(): void;
}) {
  const finished = totalRuns > 0 && finishedRuns === totalRuns;
  const evaluating = runs.filter(isScenarioEvaluationActive).length;
  const generating = runs.filter(
    (response) => isScenarioActive(response) && !isScenarioEvaluationActive(response),
  ).length;
  const failed = runs.filter(
    ({ evaluations, scenario }) =>
      scenario.status === "failed" ||
      scenario.status === "interrupted" ||
      Boolean(scenario.evaluationErrorMessage) ||
      evaluations.some(({ status }) => status === "failed" || status === "interrupted"),
  ).length;
  return (
    <section aria-label="Scenario batch progress" className="mb-6 rounded-xl bg-background/60 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-xs font-semibold">
            {error
              ? "Scenario Status Unavailable"
              : finished
                ? "Scenario Batch Finished"
                : "Scenario Batch Running"}
          </h2>
          <p aria-live="polite" className="mt-1 text-[11px] text-muted-foreground">
            {finishedRuns} of {totalRuns} finished
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {error ? (
            <Button onClick={retry} size="sm" variant="outline">
              <RotateCcw className="size-3.5" /> Retry
            </Button>
          ) : (
            <strong className="font-mono text-lg font-semibold leading-none">{progress}%</strong>
          )}
          {finished || error ? (
            <Button
              aria-label="Dismiss Scenario batch monitor"
              onClick={dismiss}
              size="icon"
              variant="ghost"
            >
              <X className="size-3.5" />
            </Button>
          ) : null}
        </div>
      </div>
      <div
        aria-label="Scenario batch progress"
        aria-valuemax={totalRuns}
        aria-valuemin={0}
        aria-valuenow={finishedRuns}
        className="mt-3 h-2 overflow-hidden rounded-full bg-border"
        role="progressbar"
      >
        <div
          className="h-full rounded-full bg-foreground transition-[width] duration-500"
          style={{ width: `${progress}%` }}
        />
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-center text-[11px] text-muted-foreground">
        <span>
          <strong className="block font-mono text-foreground">{generating}</strong> generating
        </span>
        <span>
          <strong className="block font-mono text-foreground">{evaluating}</strong> evaluating
        </span>
        <span>
          <strong
            className={cn("block font-mono", failed ? "text-destructive" : "text-foreground")}
          >
            {failed}
          </strong>{" "}
          failed
        </span>
      </div>
      {error ? (
        <p className="mt-3 text-[11px] leading-5 text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      {tracksCurrentSetup ? null : (
        <p className="mt-3 text-[11px] leading-5 text-muted-foreground">
          This batch used a different setup than the form on the left.
        </p>
      )}
      {runs.length ? (
        <div className="mt-3 max-h-56 divide-y overflow-y-auto border-t">
          {runs.map((response, index) => {
            const { scenario } = response;
            const evaluationActive = isScenarioEvaluationActive(response);
            return (
              <div
                className="grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-2 py-2 text-xs"
                key={scenario.id}
              >
                <span className="font-mono text-[11px] text-muted-foreground">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span className="min-w-0 truncate text-[11px] text-muted-foreground">
                  {scenario.mode === "generative" ? "Generative" : "Static"} ·{" "}
                  {scenario.targetModel}
                </span>
                <Link
                  className="inline-flex items-center gap-1 font-medium hover:underline"
                  href={`/evaluations/scenarios/${scenario.id}`}
                >
                  {scenario.status === "running" || scenario.status === "queued"
                    ? "Generating"
                    : evaluationActive
                      ? "Evaluating"
                      : scenario.status === "completed"
                        ? "Completed"
                        : "Failed"}
                  <ChevronRight className="size-3" />
                </Link>
              </div>
            );
          })}
        </div>
      ) : null}
      {!finished ? (
        <p className="mt-3 text-[11px] leading-5 text-muted-foreground">
          These runs are durable. Leaving this page will not stop them.
        </p>
      ) : null}
    </section>
  );
}

function RunSection({
  action,
  children,
  description,
  title,
}: {
  action?: React.ReactNode;
  children: React.ReactNode;
  description: string;
  title: string;
}) {
  return (
    <section className="border-b py-5 last:border-b-0">
      <div className="flex items-start justify-between gap-4 pb-4">
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{description}</p>
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

function Field({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium">{label}</span>
      {children}
    </label>
  );
}

function ScenarioMessagesEditor({
  messages,
  onChange,
  scenarioNumber,
}: {
  messages: string[];
  onChange(messages: string[]): void;
  scenarioNumber: number;
}) {
  return (
    <div className="space-y-2 px-3 py-2">
      {messages.map((message, messageIndex) => (
        <div className="relative" key={messageIndex}>
          <span className="pointer-events-none absolute top-2 left-3 z-10 font-mono text-[10px] uppercase text-muted-foreground">
            Message {String(messageIndex + 1).padStart(2, "0")}
          </span>
          <Textarea
            aria-label={`Scenario ${scenarioNumber} user message ${messageIndex + 1}`}
            className="!min-h-20 pt-7 pr-11 shadow-none"
            onChange={(event) =>
              onChange(
                messages.map((value, valueIndex) =>
                  valueIndex === messageIndex ? event.target.value : value,
                ),
              )
            }
            placeholder="Enter user message"
            value={message}
          />
          <Button
            aria-label={`Remove user message ${messageIndex + 1} from Scenario ${scenarioNumber}`}
            className="absolute top-1.5 right-1.5 !size-8 text-muted-foreground hover:text-destructive"
            disabled={messages.length === 1}
            onClick={() => {
              if (messages.length > 1) {
                onChange(messages.filter((_, index) => index !== messageIndex));
              }
            }}
            size="icon"
            variant="ghost"
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      ))}
      <Button
        className="h-8 justify-start px-2 text-muted-foreground hover:text-foreground"
        disabled={messages.length >= 10}
        onClick={() => onChange([...messages, ""])}
        size="sm"
        variant="ghost"
      >
        <Plus className="size-3.5" /> Add message
      </Button>
    </div>
  );
}

function DriverModelPicker({
  className,
  models,
  onChange,
  selected,
}: {
  className?: string;
  models: ConfiguredModel[];
  onChange(value: string): void;
  selected: string;
}) {
  return (
    <fieldset className={className}>
      <legend className="text-xs font-medium">Driver Model</legend>
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          aria-pressed={!selected}
          className={cn(
            "inline-flex h-7 items-center rounded-full border px-2.5 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            selected
              ? "bg-background text-foreground hover:bg-accent"
              : "border-foreground bg-foreground text-background",
          )}
          onClick={() => onChange("")}
          type="button"
        >
          Same as Target
        </button>
        {models.map((model) => {
          const active = selected === model.id;
          return (
            <button
              aria-pressed={active}
              className={cn(
                "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[11px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                active
                  ? "border-foreground bg-foreground text-background"
                  : "bg-background text-foreground hover:bg-accent",
              )}
              key={model.id}
              onClick={() => onChange(model.id)}
              type="button"
            >
              <ModelIdentityLabel labelClassName="font-medium leading-none" model={model} />
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

function getSetupRequirements(input: {
  configurationIds: string[];
  draftScenarioCount: number;
  judgeModels: string[];
  promptId: string;
  repetitions: number;
  scenarioCount: number;
  scenarioMode: ScenarioMode;
  scenariosReady: boolean;
  selectedPrompt?: PromptSummary;
  targetModels: string[];
}): Array<{ label: string; models?: string[]; ready: boolean; value: string }> {
  return [
    {
      label: "Prompt Revision",
      ready: Boolean(input.promptId),
      value: input.selectedPrompt
        ? `${input.selectedPrompt.title} · v${input.selectedPrompt.revisionNumber}`
        : "Choose a revision",
    },
    {
      label: "Target Models",
      models: input.targetModels,
      ready: input.targetModels.length > 0,
      value: input.targetModels.length ? count(input.targetModels.length, "model") : "Required",
    },
    {
      label: "Judge Models",
      models: input.judgeModels,
      ready: input.judgeModels.length > 0,
      value: input.judgeModels.length ? count(input.judgeModels.length, "model") : "Required",
    },
    {
      label: "Criteria",
      ready: input.configurationIds.length > 0 && input.configurationIds.length <= 12,
      value: input.configurationIds.length
        ? input.configurationIds.length > 12
          ? "Maximum 12 sets"
          : count(input.configurationIds.length, "set")
        : "Required",
    },
    {
      label: "Scenarios",
      ready: input.scenariosReady,
      value: input.scenariosReady
        ? count(input.scenarioCount, "Scenario")
        : input.scenarioMode === "static" && input.scenarioCount === input.draftScenarioCount
          ? "Use 1–10 turns per Scenario"
          : `${input.draftScenarioCount - input.scenarioCount} incomplete`,
    },
    {
      label: "Repetitions",
      ready: input.repetitions > 0,
      value: String(input.repetitions),
    },
  ];
}

function Definition({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 px-3 py-2">
      <dt className="text-[10px] uppercase text-muted-foreground">{label}</dt>
      <dd className="mt-1 truncate font-medium">{value}</dd>
    </div>
  );
}

function ManifestFact({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-0 border-r px-2 py-3 last:border-r-0">
      <strong className="block truncate font-mono text-lg font-semibold tabular-nums">
        {value.toLocaleString()}
      </strong>
      <span className="mt-0.5 block truncate text-[10px] uppercase text-muted-foreground">
        {label}
      </span>
    </div>
  );
}

function WorkloadCalculation({
  criteriaCount,
  executions,
  outputs,
  repetitions,
  scenarios,
  targets,
}: {
  criteriaCount: number;
  executions: number;
  outputs: number;
  repetitions: number;
  scenarios: number;
  targets: number;
}) {
  return (
    <div className="py-3 text-[11px] leading-4">
      <p className="font-mono text-foreground">
        {`${count(scenarios, "Scenario")} × ${count(targets, "target model")} × ${count(repetitions, "repetition")} = ${count(outputs, "conversation")}`}
      </p>
      <p className="mt-1 text-muted-foreground">
        {`${count(executions, "Scenario Run")}. Each completed conversation starts ${count(criteriaCount, "recorded evaluation")}.`}
      </p>
    </div>
  );
}

function count(value: number, noun: string): string {
  return `${value} ${noun}${value === 1 ? "" : "s"}`;
}

type ScenarioCreateRequest = {
  promptId: string;
  promptRevisionId: string;
  targetModel: string;
  reasoningEffort: "medium";
  evaluationPlan: {
    configurations: Array<Omit<EvaluationBatchConfiguration, "id">>;
    judgeModels: string[];
  };
} & (
  | {
      mode: "generative";
      instruction: string;
      driverModel?: string;
      maxTurns: number;
    }
  | { mode: "static"; messages: string[] }
);

function buildScenarioMatrix(input: {
  prompt: PromptSummary;
  targetModels: string[];
  judgeModels: string[];
  criteria: Criteria[];
  configurationIds: string[];
  scenarioMode: ScenarioMode;
  scenarios: ScenarioDraft[];
  driverModel: string;
  repetitions: number;
}): { requests: ScenarioCreateRequest[]; signature: string } {
  const evaluationPlan = {
    configurations: input.criteria
      .filter(({ id }) => input.configurationIds.includes(id))
      .map(({ criterionSequence, name }) => ({
        name,
        criteria: criterionSequence.map(
          ({ id: _criterionId, version: _criterionVersion, ...criterion }) => criterion,
        ),
      })),
    judgeModels: input.judgeModels,
  };
  const requests = input.scenarios
    .filter((scenario) => hasScenarioContent(scenario, input.scenarioMode))
    .flatMap((scenario) =>
      input.targetModels.flatMap((targetModel) =>
        Array.from({ length: input.repetitions }, (): ScenarioCreateRequest => {
          const common = {
            promptId: input.prompt.id,
            promptRevisionId: input.prompt.revisionId,
            targetModel,
            reasoningEffort: "medium" as const,
            evaluationPlan,
          };
          return input.scenarioMode === "generative"
            ? {
                ...common,
                mode: "generative",
                instruction: scenario.instruction.trim(),
                ...(input.driverModel ? { driverModel: input.driverModel } : {}),
                maxTurns: scenario.maxTurns,
              }
            : {
                ...common,
                mode: "static",
                messages: scenario.messages.map((message) => message.trim()).filter(Boolean),
              };
        }),
      ),
    );
  return { requests, signature: JSON.stringify(requests) };
}

function readSavedConfigurations(): SavedConfiguration[] {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value ? (JSON.parse(value) as SavedConfiguration[]) : [];
  } catch {
    return [];
  }
}

function readLastRunConfiguration(): LastRunConfiguration | undefined {
  try {
    const value = window.localStorage.getItem(LAST_RUN_STORAGE_KEY);
    return value ? (JSON.parse(value) as LastRunConfiguration) : undefined;
  } catch {
    return undefined;
  }
}

function readTrackedScenarioBatch(): TrackedScenarioBatch | undefined {
  try {
    const value = window.localStorage.getItem(TRACKED_SCENARIO_STORAGE_KEY);
    return value ? (JSON.parse(value) as TrackedScenarioBatch) : undefined;
  } catch {
    return undefined;
  }
}

function createScenarioDraft(): ScenarioDraft {
  return { ...DEFAULT_SCENARIO, messages: [""] };
}

function hasScenarioContent(scenario: ScenarioDraft, mode: ScenarioMode): boolean {
  return mode === "generative"
    ? Boolean(scenario.instruction.trim())
    : scenario.messages.some((message) => message.trim());
}

function normalizeScenarios(scenarios: ScenarioDraft[], mode: ScenarioMode): ScenarioDraft[] {
  const complete = scenarios
    .filter((scenario) => hasScenarioContent(scenario, mode))
    .slice(0, MAX_SCENARIOS)
    .map((scenario) => ({
      ...scenario,
      messages: scenario.messages.length ? scenario.messages.slice(0, 10) : [""],
    }));
  return complete.length ? complete : [createScenarioDraft()];
}

function restoreSelection<T extends { id: string }>(
  saved: string[] | undefined,
  available: T[],
  fallback: string[],
): string[] {
  if (!saved) return fallback;
  const restored = saved.filter((id) => available.some((item) => item.id === id));
  return saved.length > 0 && restored.length === 0 ? fallback : restored;
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  operation: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, async () => {
      while (nextIndex < values.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await operation(values[index] as T, index);
      }
    }),
  );
  return results;
}
