/** Owns the human batch-run setup experience while delegating matrix expansion and execution accounting to the evaluation API. */

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
import Link from "next/link";
import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { ModelIdentityLabel } from "@/components/chat/model-selector";
import {
  CriteriaProfilePicker,
  EvaluationModelPicker,
} from "@/components/evaluations/run/selectors";
import { EvaluationPageBar } from "@/components/evaluations/shared/evaluation-page-bar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { maximumResizablePanelWidth, ResizableDivider } from "@/components/ui/resizable-divider";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/components/ui/utils";
import type { ConfiguredModel, ConfiguredModelsResponse } from "@/contracts/chat";
import type {
  CriteriaProfile,
  CriteriaProfilesResponse,
  EvaluationBatchConfiguration,
  EvaluationBatchPreview,
  EvaluationBatchRequest,
  EvaluationBatchStart,
  EvaluationBatchStatus,
  EvaluationRunStatus,
  EvaluationRunSummary,
} from "@/contracts/evaluations";
import type { PromptsResponse, PromptSummary } from "@/contracts/prompts";
import type { TargetProfile, TargetProfileResponse } from "@/contracts/targets";
import { createApiRequester, createErrorReader } from "@/shared/api";

import { RecordedEvaluationBuilder } from "./recorded";

type SavedConfiguration = {
  cases: string[];
  configurationIds: string[];
  judges: string[];
  name: string;
  repetitions: number;
  targetModelIds: string[];
};

type LastRunConfiguration = Omit<SavedConfiguration, "name"> & { promptId: string };

type TrackedBatch = {
  request: EvaluationBatchRequest;
  runIds: string[];
};

const STORAGE_KEY = "vibe-prompting.evaluation-configurations.v1";
const LAST_RUN_STORAGE_KEY = "vibe-prompting.evaluation-run.v1";
const TRACKED_BATCH_STORAGE_KEY = "vibe-prompting.evaluation-batch.v1";
const TERMINAL_STATUSES = new Set<EvaluationRunStatus>(["completed", "failed", "interrupted"]);
const evaluationApi = createApiRequester({}, (status) => `Request failed with ${status}.`);
const readError = createErrorReader("The evaluation request failed.");
const MANIFEST_MIN_WIDTH = 256;
const MANIFEST_MAX_WIDTH = 560;
const RUN_FORM_MIN_WIDTH = 440;

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
  return <EvaluationBatchRunBuilder />;
}

function EvaluationBatchRunBuilder() {
  const [prompts, setPrompts] = useState<PromptSummary[]>([]);
  const [models, setModels] = useState<ConfiguredModel[]>([]);
  const [profiles, setProfiles] = useState<CriteriaProfile[]>([]);
  const [promptId, setPromptId] = useState("");
  const [targetProfile, setTargetProfile] = useState<TargetProfile | null>();
  const [targetModelIds, setTargetModelIds] = useState<string[]>([]);
  const [judges, setJudges] = useState<string[]>([]);
  const [configurationIds, setConfigurationIds] = useState<string[]>([]);
  const [repetitions, setRepetitions] = useState(3);
  const [cases, setCases] = useState<string[]>([""]);
  const [preview, setPreview] = useState<EvaluationBatchPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [running, setRunning] = useState(false);
  const [startedRuns, setStartedRuns] = useState<EvaluationRunSummary[]>([]);
  const [savedConfigurations, setSavedConfigurations] = useState<SavedConfiguration[]>([]);
  const [savedName, setSavedName] = useState("");
  const [runStateReady, setRunStateReady] = useState(false);
  const [trackedBatch, setTrackedBatch] = useState<TrackedBatch | null>(null);
  const [batchStatusError, setBatchStatusError] = useState<string>();
  const [batchRetry, setBatchRetry] = useState(0);
  const [manifestWidth, setManifestWidth] = useState<number>();
  const workspaceRef = useRef<HTMLDivElement>(null);
  const manifestRef = useRef<HTMLElement>(null);
  const trackedRunIds = trackedBatch?.runIds.join(",") ?? "";
  const selectedPrompt = prompts.find(({ id }) => id === promptId);
  const request = useMemo(
    () =>
      selectedPrompt
        ? buildRequest({
            cases,
            configurationIds,
            judges,
            profiles,
            prompt: selectedPrompt,
            repetitions,
            targetModelIds,
          })
        : null,
    [cases, configurationIds, judges, profiles, repetitions, selectedPrompt, targetModelIds],
  );

  useEffect(() => {
    Promise.all([
      evaluationApi.json<ConfiguredModelsResponse>("/api/config"),
      evaluationApi.json<PromptsResponse>("/api/prompts"),
      evaluationApi.json<CriteriaProfilesResponse>("/api/evaluations/criteria-profiles"),
    ])
      .then(([config, promptData, profileData]) => {
        const lastRun = readLastRunConfiguration();
        const lastBatch = readTrackedBatch();
        setModels(config.models);
        setProfiles(profileData.profiles);
        setPrompts(promptData.prompts);
        setPromptId(
          lastRun && promptData.prompts.some(({ id }) => id === lastRun.promptId)
            ? lastRun.promptId
            : "",
        );
        setTargetModelIds(restoreSelection(lastRun?.targetModelIds, config.models, []));
        setJudges(restoreSelection(lastRun?.judges, config.models, []));
        setConfigurationIds(restoreSelection(lastRun?.configurationIds, profileData.profiles, []));
        if (lastRun) {
          setCases(lastRun.cases);
          setRepetitions(lastRun.repetitions);
        }
        if (lastBatch) setTrackedBatch(lastBatch);
        setRunStateReady(true);
      })
      .catch((error) => toast.error(readError(error)));
    setSavedConfigurations(readSavedConfigurations());
  }, []);

  useEffect(() => {
    if (!runStateReady) return;
    const lastRun: LastRunConfiguration = {
      cases,
      configurationIds,
      judges,
      promptId,
      repetitions,
      targetModelIds,
    };
    window.localStorage.setItem(LAST_RUN_STORAGE_KEY, JSON.stringify(lastRun));
  }, [cases, configurationIds, judges, promptId, repetitions, runStateReady, targetModelIds]);

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
    if (
      !request ||
      request.configurations.length === 0 ||
      request.targetModelIds.length === 0 ||
      request.judges.length === 0 ||
      request.cases.some(({ input }) => !input.trim())
    ) {
      setPreview(null);
      return;
    }
    let active = true;
    const timer = window.setTimeout(() => {
      setPreviewing(true);
      void evaluationApi
        .json<EvaluationBatchPreview>("/api/evaluations/preview", {
          body: JSON.stringify(request),
          headers: { "content-type": "application/json" },
          method: "POST",
        })
        .then((value) => {
          if (active) setPreview(value);
        })
        .catch((error) => {
          if (active) {
            setPreview(null);
            toast.error(readError(error));
          }
        })
        .finally(() => {
          if (active) setPreviewing(false);
        });
    }, 280);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [request]);

  useEffect(() => {
    if (!trackedRunIds) {
      setStartedRuns([]);
      setBatchStatusError(undefined);
      return;
    }
    setBatchStatusError(undefined);
    let active = true;
    let timer: number | undefined;
    const runIds = trackedRunIds.split(",");
    const refresh = async () => {
      try {
        const result = await fetchBatchStatus(runIds);
        if (!active) return;
        setStartedRuns(result.runs);
        setBatchStatusError(undefined);
        if (result.runs.every(({ status }) => TERMINAL_STATUSES.has(status)) && timer) {
          window.clearInterval(timer);
        }
      } catch (error) {
        if (active) {
          if (timer) window.clearInterval(timer);
          setBatchStatusError(readError(error));
        }
      }
    };
    timer = window.setInterval(() => void refresh(), 1500);
    void refresh();
    return () => {
      active = false;
      if (timer) window.clearInterval(timer);
    };
  }, [batchRetry, trackedRunIds]);

  async function startBatch() {
    if (!request || !preview) return;
    setRunning(true);
    try {
      const result = await evaluationApi.json<EvaluationBatchStart>("/api/evaluations/batches", {
        body: JSON.stringify(request),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      setStartedRuns(result.runs);
      setBatchStatusError(undefined);
      const nextTrackedBatch = { request, runIds: result.runs.map(({ id }) => id) };
      window.localStorage.setItem(TRACKED_BATCH_STORAGE_KEY, JSON.stringify(nextTrackedBatch));
      setTrackedBatch(nextTrackedBatch);
      toast.success(`Started ${result.runs.length} evaluation executions.`);
    } catch (error) {
      toast.error(readError(error));
    } finally {
      setRunning(false);
    }
  }

  function dismissBatch() {
    window.localStorage.removeItem(TRACKED_BATCH_STORAGE_KEY);
    setTrackedBatch(null);
    setStartedRuns([]);
    setBatchStatusError(undefined);
  }

  function saveConfiguration() {
    const name = savedName.trim();
    if (!name) return toast.error("Name this setup before saving it.");
    const replaced = savedConfigurations.some((configuration) => configuration.name === name);
    const next = [
      ...savedConfigurations.filter((configuration) => configuration.name !== name),
      { cases, configurationIds, judges, name, repetitions, targetModelIds },
    ];
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    setSavedConfigurations(next);
    setSavedName("");
    toast.success(
      replaced ? `Replaced “${name}” in this browser.` : `Saved “${name}” in this browser.`,
    );
  }

  function loadConfiguration(value: string) {
    const saved = savedConfigurations.find(({ name }) => name === value);
    if (!saved) return;
    setCases(saved.cases);
    setConfigurationIds(
      saved.configurationIds.filter((id) => profiles.some((profile) => profile.id === id)),
    );
    setJudges(saved.judges.filter((id) => models.some((model) => model.id === id)));
    setRepetitions(saved.repetitions);
    setTargetModelIds(saved.targetModelIds.filter((id) => models.some((model) => model.id === id)));
  }

  const trackedRunCount = trackedBatch?.runIds.length ?? 0;
  const finishedRuns = startedRuns.filter(({ status }) => TERMINAL_STATUSES.has(status)).length;
  const completedRuns = startedRuns.filter(({ status }) => status === "completed").length;
  const failedRuns = startedRuns.filter(
    ({ status }) => status === "failed" || status === "interrupted",
  ).length;
  const runningRuns = startedRuns.filter(({ status }) => status === "running").length;
  const progress = trackedRunCount ? Math.round((finishedRuns / trackedRunCount) * 100) : 0;
  const batchFinished = trackedRunCount > 0 && finishedRuns === trackedRunCount;
  const batchRunning = trackedRunCount > 0 && !batchFinished;
  const tracksCurrentSetup = Boolean(
    request && trackedBatch && sameBatchRequest(request, trackedBatch.request),
  );
  const setupRequirements = getSetupRequirements({
    cases,
    configurationIds,
    judges,
    promptId,
    repetitions,
    selectedPrompt,
    targetModelIds,
  });
  const completeCaseCount = cases.filter((value) => value.trim()).length;
  const selectedCriteriaSets = profiles.filter(({ id }) => configurationIds.includes(id));
  const executionCount =
    preview?.executionCount ?? selectedCriteriaSets.length * targetModelIds.length * repetitions;
  const targetOutputCount = preview?.targetCaseInvocations ?? executionCount * completeCaseCount;
  const judgeDecisionCount =
    preview?.judgeScoreDecisions ??
    targetModelIds.length *
      repetitions *
      completeCaseCount *
      judges.length *
      selectedCriteriaSets.reduce((total, profile) => total + profile.criteria.length, 0);
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
          <h1 className="shrink-0 text-base font-semibold tracking-tight">Evaluation run</h1>
          <p className="hidden min-w-0 flex-1 truncate text-xs text-muted-foreground @min-[920px]:block">
            Configure prompt, models, criteria, cases, and repetitions.
          </p>
          <p className="ml-auto shrink-0 font-mono text-[11px] uppercase text-muted-foreground">
            {count(cases.length, "case")} · {repetitions}×
          </p>
        </EvaluationPageBar>

        <div className="px-4 pb-12 sm:px-6 min-[840px]:px-7 xl:px-10">
          <RunSection
            description="Choose the prompt revision, target models that answer, and judge models that score."
            title="Prompt and models"
          >
            <div className="grid gap-4 @min-[980px]:grid-cols-[minmax(18rem,1fr)_minmax(16rem,0.8fr)]">
              <Field label="Prompt revision">
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
                  label="Agent setup"
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
              label="Target models"
              models={models}
              onChange={setTargetModelIds}
              selected={targetModelIds}
            />
            <EvaluationModelPicker
              className="mt-4"
              label="Judge models"
              models={models}
              onChange={setJudges}
              selected={judges}
            />
          </RunSection>

          <RunSection
            description="Choose reusable criteria sets; every judge applies every criterion in each selected set."
            title="Criteria"
          >
            <CriteriaProfilePicker
              actions={
                <div className="flex items-center gap-3 text-xs">
                  <button
                    className="text-muted-foreground hover:text-foreground"
                    onClick={() => setConfigurationIds(profiles.map(({ id }) => id))}
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
                    href="/evaluations/criteria"
                  >
                    <SlidersHorizontal className="size-3.5" /> Manage
                  </Link>
                </div>
              }
              onChange={setConfigurationIds}
              profiles={profiles}
              selected={configurationIds}
            />
          </RunSection>

          <RunSection
            action={
              <Button onClick={() => setCases([...cases, ""])} size="sm" variant="outline">
                <Plus className="size-3.5" /> Add case
              </Button>
            }
            description="Each input runs through every selected criteria set, target model, and repetition."
            title="Cases"
          >
            <div className="overflow-hidden border-y">
              <div className="grid grid-cols-[3rem_minmax(0,1fr)_2.75rem] items-center bg-muted/40 text-[11px] uppercase text-muted-foreground">
                <span className="px-3 py-2 font-mono">Case</span>
                <span className="px-3 py-2 font-mono">Input</span>
                <span className="sr-only">Actions</span>
              </div>
              <div className="divide-y">
                {cases.map((value, index) => (
                  <div
                    className="grid grid-cols-[3rem_minmax(0,1fr)_2.75rem] items-start"
                    key={index}
                  >
                    <span className="px-3 py-3 font-mono text-[11px] text-muted-foreground">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <Textarea
                      aria-label={`Case ${index + 1}`}
                      className="my-2 min-h-16 rounded-none border-0 px-3 shadow-none focus-visible:ring-1"
                      onChange={(event) =>
                        setCases(
                          cases.map((item, itemIndex) =>
                            itemIndex === index ? event.target.value : item,
                          ),
                        )
                      }
                      placeholder="Enter the input to evaluate"
                      value={value}
                    />
                    <Button
                      aria-label={`Remove case ${index + 1}`}
                      className="mt-2"
                      disabled={cases.length === 1}
                      onClick={() => setCases(cases.filter((_, itemIndex) => itemIndex !== index))}
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
            title="Run options"
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
              <Field label="Load setup">
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
                <Field label="Save current setup">
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
            <h2 className="text-sm font-semibold">Execution manifest</h2>
            {previewing ? (
              <LoaderCircle
                aria-label="Refreshing manifest"
                className="size-4 animate-spin text-muted-foreground"
              />
            ) : null}
          </EvaluationPageBar>
          <div className="flex min-h-0 flex-1 flex-col px-4 py-4 sm:px-5">
            {trackedBatch ? (
              <BatchMonitor
                completedRuns={completedRuns}
                dismiss={dismissBatch}
                error={batchStatusError}
                failedRuns={failedRuns}
                finishedRuns={finishedRuns}
                models={models}
                progress={progress}
                retry={() => setBatchRetry((current) => current + 1)}
                runningRuns={runningRuns}
                runs={startedRuns}
                totalRuns={trackedRunCount}
                tracksCurrentSetup={tracksCurrentSetup}
              />
            ) : null}
            <div>
              <p className="pb-3 text-xs font-medium">Setup readiness</p>
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
                        {requirement.modelIds?.length ? (
                          <div className="flex min-w-0 flex-col items-end gap-1">
                            {requirement.modelIds.map((modelId) => (
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
              cases={completeCaseCount}
              criteriaSets={selectedCriteriaSets.length}
              executions={executionCount}
              outputs={targetOutputCount}
              repetitions={repetitions}
              targets={targetModelIds.length}
            />
            {preview ? (
              <>
                <div className="border-y">
                  <div className="grid grid-cols-[2rem_minmax(0,1fr)] gap-2 bg-muted/40 px-2 py-2 font-mono text-[10px] uppercase text-muted-foreground">
                    <span>No.</span>
                    <span>Execution lane</span>
                  </div>
                  <div className="divide-y">
                    {preview.jobs.slice(0, 200).map((job) => (
                      <div
                        className="grid grid-cols-[2rem_minmax(0,1fr)] items-center gap-2 px-2 py-2 text-xs"
                        key={job.id}
                      >
                        <span className="font-mono text-[11px] text-muted-foreground">
                          {String(job.executionNumber).padStart(2, "0")}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate font-medium leading-4">
                            {job.configurationName}
                          </span>
                          <span className="flex min-w-0 items-center gap-1 text-[11px] leading-4 text-muted-foreground">
                            <ModelIdentityLabel
                              className="min-w-0"
                              labelClassName="truncate"
                              model={models.find(({ id }) => id === job.targetModelId)}
                              modelId={job.targetModelId}
                            />
                            <span className="shrink-0">· repetition {job.repetition}</span>
                          </span>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
                {preview.jobs.length > 200 && (
                  <p className="mt-3 text-xs text-muted-foreground">
                    Showing the first 200 of {preview.jobs.length} executions. All executions will
                    run.
                  </p>
                )}
              </>
            ) : null}
            <Button
              className="mt-4 w-full"
              disabled={!preview || running || batchRunning}
              onClick={startBatch}
            >
              {running ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : batchRunning ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : batchFinished && tracksCurrentSetup ? (
                <RotateCcw className="size-4" />
              ) : null}
              {running
                ? "Starting matrix…"
                : batchRunning
                  ? `Running ${runningRuns} of ${trackedRunCount}`
                  : batchFinished && tracksCurrentSetup
                    ? "Run matrix again"
                    : preview
                      ? `Run ${preview.executionCount} executions`
                      : "Run evaluation"}
            </Button>
          </div>
        </div>
      </aside>
    </div>
  );
}

/** Reports the batch this browser started, independently of the draft below it, so editing the form never hides work that is still running. */
function BatchMonitor({
  completedRuns,
  dismiss,
  error,
  failedRuns,
  finishedRuns,
  models,
  progress,
  retry,
  runningRuns,
  runs,
  totalRuns,
  tracksCurrentSetup,
}: {
  completedRuns: number;
  dismiss(): void;
  error?: string;
  failedRuns: number;
  finishedRuns: number;
  models: ConfiguredModel[];
  progress: number;
  retry(): void;
  runningRuns: number;
  runs: EvaluationRunSummary[];
  totalRuns: number;
  tracksCurrentSetup: boolean;
}) {
  const finished = finishedRuns === totalRuns;
  return (
    <section aria-label="Batch progress" className="mb-6 rounded-xl bg-background/60 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-xs font-semibold">
            {error ? "Batch status unavailable" : finished ? "Batch finished" : "Batch running"}
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
              aria-label="Dismiss batch monitor"
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
        aria-label="Evaluation batch progress"
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
      <div className="mt-3 grid grid-cols-3 gap-2 text-[11px] text-muted-foreground">
        <span>
          <strong className="font-mono text-foreground">{completedRuns}</strong> completed
        </span>
        <span className="text-center">
          <strong className="font-mono text-foreground">{runningRuns}</strong> running
        </span>
        <span className="text-right">
          <strong
            className={cn("font-mono", failedRuns > 0 ? "text-destructive" : "text-foreground")}
          >
            {failedRuns}
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
          {runs.map((run, index) => (
            <div className="py-1.5" key={run.id}>
              <div className="grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-2 text-xs">
                <span className="font-mono text-[11px] text-muted-foreground">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <ModelIdentityLabel
                  className="min-w-0 text-muted-foreground"
                  labelClassName="truncate text-[11px]"
                  model={models.find(({ id }) => id === run.targetModelId)}
                  modelId={run.targetModelId}
                />
                <Link
                  className="inline-flex items-center gap-1 font-medium hover:underline"
                  href={`/evaluations/${run.id}`}
                >
                  {statusLabel(run.status)}
                  <ChevronRight className="size-3" />
                </Link>
              </div>
              {run.errorMessage ? (
                <p className="mt-1 pl-10 text-[11px] leading-4 text-destructive">
                  {run.errorMessage}
                </p>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
      {finished ? (
        <Link
          className="mt-3 inline-flex h-8 w-full items-center justify-center gap-2 rounded-md border border-input bg-background text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
          href="/evaluations/analytics"
        >
          Compare these runs in analytics
        </Link>
      ) : (
        <p className="mt-3 text-[11px] leading-5 text-muted-foreground">
          These runs are durable. Leaving this page will not stop them.
        </p>
      )}
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

function getSetupRequirements(input: {
  cases: string[];
  configurationIds: string[];
  judges: string[];
  promptId: string;
  repetitions: number;
  selectedPrompt?: PromptSummary;
  targetModelIds: string[];
}): Array<{ label: string; modelIds?: string[]; ready: boolean; value: string }> {
  const completeCases = input.cases.filter((value) => value.trim()).length;
  return [
    {
      label: "Prompt revision",
      ready: Boolean(input.promptId),
      value: input.selectedPrompt
        ? `${input.selectedPrompt.title} · v${input.selectedPrompt.revisionNumber}`
        : "Choose a revision",
    },
    {
      label: "Target models",
      modelIds: input.targetModelIds,
      ready: input.targetModelIds.length > 0,
      value: input.targetModelIds.length ? count(input.targetModelIds.length, "model") : "Required",
    },
    {
      label: "Judge models",
      modelIds: input.judges,
      ready: input.judges.length > 0,
      value: input.judges.length ? count(input.judges.length, "model") : "Required",
    },
    {
      label: "Criteria",
      ready: input.configurationIds.length > 0,
      value: input.configurationIds.length
        ? count(input.configurationIds.length, "set")
        : "Required",
    },
    {
      label: "Cases",
      ready: completeCases === input.cases.length,
      value:
        completeCases === input.cases.length
          ? count(completeCases, "case")
          : `${input.cases.length - completeCases} incomplete`,
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
  cases,
  criteriaSets,
  executions,
  outputs,
  repetitions,
  targets,
}: {
  cases: number;
  criteriaSets: number;
  executions: number;
  outputs: number;
  repetitions: number;
  targets: number;
}) {
  return (
    <div className="py-3 text-[11px] leading-4">
      <p className="font-mono text-foreground">
        {count(criteriaSets, "criteria set")} × {count(targets, "target model")} ×{" "}
        {count(repetitions, "repetition")} × {count(cases, "complete case")} ={" "}
        {count(outputs, "target output")}
      </p>
      <p className="mt-1 text-muted-foreground">
        {count(executions, "execution")}. Every execution is saved as a separate run.
      </p>
    </div>
  );
}

function count(value: number, noun: string): string {
  return `${value} ${noun}${value === 1 ? "" : "s"}`;
}

function buildRequest(input: {
  cases: string[];
  configurationIds: string[];
  judges: string[];
  profiles: CriteriaProfile[];
  prompt: PromptSummary;
  repetitions: number;
  targetModelIds: string[];
}): EvaluationBatchRequest {
  return {
    cases: input.cases.map((caseInput) => ({ input: caseInput })),
    configurations: input.profiles
      .filter(({ id }) => input.configurationIds.includes(id))
      .map(({ criteria, id, name }): EvaluationBatchConfiguration => ({ criteria, id, name })),
    isSyntheticExample: false,
    judges: input.judges,
    promptId: input.prompt.id,
    promptRevisionId: input.prompt.revisionId,
    repetitions: input.repetitions,
    targetModelIds: input.targetModelIds,
  };
}

function statusLabel(status: EvaluationRunStatus): string {
  return status === "completed"
    ? "Completed"
    : status === "failed"
      ? "Failed"
      : status === "interrupted"
        ? "Interrupted"
        : "Running";
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

function readTrackedBatch(): TrackedBatch | undefined {
  try {
    const value = window.localStorage.getItem(TRACKED_BATCH_STORAGE_KEY);
    return value ? (JSON.parse(value) as TrackedBatch) : undefined;
  } catch {
    return undefined;
  }
}

function sameBatchRequest(left: EvaluationBatchRequest, right: EvaluationBatchRequest): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
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

async function fetchBatchStatus(runIds: string[]): Promise<EvaluationBatchStatus> {
  const chunks = Array.from({ length: Math.ceil(runIds.length / 200) }, (_, index) =>
    runIds.slice(index * 200, (index + 1) * 200),
  );
  const responses = await Promise.all(
    chunks.map((chunk) => {
      const query = new URLSearchParams(chunk.map((runId) => ["runId", runId]));
      return evaluationApi.json<EvaluationBatchStatus>(`/api/evaluations/batches?${query}`);
    }),
  );
  return { runs: responses.flatMap(({ runs }) => runs) };
}
