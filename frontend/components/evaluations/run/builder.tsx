/** Owns the human batch-run setup experience while delegating matrix expansion and execution accounting to the evaluation API. */

"use client";

import {
  ChevronRight,
  CircleAlert,
  LoaderCircle,
  Plus,
  RotateCcw,
  Save,
  SlidersHorizontal,
  Trash2,
  X,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { ModelIdentityLabel } from "@/components/chat/model-selector";
import {
  CriteriaProfilePicker,
  EvaluationModelPicker,
} from "@/components/evaluations/run/selectors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
    if (!name) return toast.error("Name this configuration before saving it.");
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
  const missingRequirements = getMissingRequirements({
    cases,
    configurationIds,
    judges,
    promptId,
    targetModelIds,
  });

  return (
    <div className="mx-auto grid w-full max-w-[1480px] grid-cols-1 bg-muted/15 @min-[720px]:grid-cols-[minmax(0,1fr)_18rem] @min-[900px]:grid-cols-[minmax(0,1fr)_20rem] @min-[1200px]:grid-cols-[minmax(0,1fr)_25rem]">
      <section className="min-w-0 bg-background px-4 py-5 sm:px-6 @min-[720px]:border-r xl:px-10 xl:py-8">
        <div className="mb-6 max-w-2xl xl:mb-8">
          <h2 className="text-xl font-semibold tracking-[-0.02em]">
            Configure an evaluation matrix
          </h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Choose the target, score profiles, cases, and repetitions. The manifest at right is the
            exact server-expanded workload.
          </p>
        </div>

        <RunSection
          description="Run one active prompt revision through the AI SDK agent."
          title="Target"
        >
          <Field label="Prompt">
            <Select onChange={(event) => setPromptId(event.target.value)} value={promptId}>
              <option value="">Choose a prompt revision</option>
              {prompts.map((prompt) => (
                <option key={prompt.id} value={prompt.id}>
                  {prompt.title} · v{prompt.revisionNumber}
                </option>
              ))}
            </Select>
          </Field>
          <div className="grid gap-3 py-2 text-sm sm:grid-cols-2">
            <Definition
              label="Target profile"
              value={
                !promptId
                  ? "Choose a prompt first"
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
                    ? `${targetProfile.configuration.maxSteps ?? "AI SDK default"} steps · ${targetProfile.configuration.tools?.length ? targetProfile.configuration.tools.join(", ") : "no tools"}`
                    : "AI SDK defaults"
              }
            />
          </div>
          <EvaluationModelPicker
            className="mt-4"
            label="Target models"
            models={models}
            onChange={setTargetModelIds}
            selected={targetModelIds}
          />
        </RunSection>

        <RunSection
          description="Each selected profile becomes an independent execution lane."
          title="Score profiles"
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
          description="Every judge scores every criterion for every case in an execution."
          title="Judges"
        >
          <EvaluationModelPicker
            className="mt-4"
            label="Judge models"
            models={models}
            onChange={setJudges}
            selected={judges}
          />
        </RunSection>

        <RunSection
          description="These inputs run once inside every profile, model, and repetition combination."
          title="Cases"
        >
          <div className="divide-y">
            {cases.map((value, index) => (
              <div className="flex gap-2 py-3" key={index}>
                <span className="mt-2 w-6 shrink-0 font-mono text-[11px] text-muted-foreground">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <Textarea
                  aria-label={`Case ${index + 1}`}
                  className="min-h-20 shadow-none"
                  onChange={(event) =>
                    setCases(
                      cases.map((item, itemIndex) =>
                        itemIndex === index ? event.target.value : item,
                      ),
                    )
                  }
                  value={value}
                />
                <Button
                  aria-label={`Remove case ${index + 1}`}
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
          <Button
            className="mt-3"
            onClick={() => setCases([...cases, ""])}
            size="sm"
            variant="outline"
          >
            <Plus className="size-3.5" />
            Add case
          </Button>
        </RunSection>

        <RunSection
          description="Repeat each target and score-profile combination to measure output variance."
          title="Repetitions"
        >
          <Field label="Runs per combination">
            <Input
              className="max-w-40"
              max={5}
              min={1}
              onChange={(event) =>
                setRepetitions(Math.max(1, Math.min(5, Number(event.target.value) || 1)))
              }
              type="number"
              value={repetitions}
            />
          </Field>
        </RunSection>

        <RunSection
          description="Saved configurations stay in this browser and can be loaded before a run."
          title="Saved configuration"
        >
          <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
            <Select defaultValue="" onChange={(event) => loadConfiguration(event.target.value)}>
              <option disabled value="">
                Load saved configuration…
              </option>
              {savedConfigurations.map(({ name }) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </Select>
            <div className="flex gap-2">
              <Input
                onChange={(event) => setSavedName(event.target.value)}
                placeholder="Configuration name"
                value={savedName}
              />
              <Button
                aria-label="Save configuration"
                onClick={saveConfiguration}
                size="icon"
                variant="outline"
              >
                <Save className="size-3.5" />
              </Button>
            </div>
          </div>
        </RunSection>
      </section>

      <aside className="border-t bg-muted/35 @min-[720px]:border-t-0">
        <div className="flex min-h-[calc(100vh-var(--header-height))] flex-col px-4 py-5 sm:px-6 @min-[720px]:sticky @min-[720px]:top-0 @min-[720px]:max-h-[calc(100vh-var(--header-height))] @min-[720px]:overflow-y-auto @min-[720px]:px-5 xl:px-6 xl:py-8">
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
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold">Execution manifest</h2>
            {previewing && (
              <LoaderCircle
                aria-label="Refreshing manifest"
                className="size-4 animate-spin text-muted-foreground"
              />
            )}
          </div>
          {preview ? (
            <>
              <div className="mt-5 rounded-xl bg-background/70 px-4 py-3">
                <p className="flex items-baseline gap-2">
                  <strong className="font-mono text-2xl font-semibold tabular-nums">
                    {preview.targetCaseInvocations.toLocaleString()}
                  </strong>
                  <span className="text-sm font-medium">
                    target output{preview.targetCaseInvocations === 1 ? "" : "s"}
                  </span>
                </p>
                <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
                  {describeWorkload(request)}
                </p>
                <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
                  Saved as {count(preview.executionCount, "run")}
                </p>
              </div>
              <div className="mt-5 divide-y">
                {preview.jobs.slice(0, 200).map((job) => (
                  <div
                    className="grid grid-cols-[2rem_minmax(0,1fr)] items-center gap-2 py-1.5 text-xs"
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
              {preview.jobs.length > 200 && (
                <p className="mt-3 text-xs text-muted-foreground">
                  Showing the first 200 of {preview.jobs.length} executions. All executions will
                  run.
                </p>
              )}
              <Button
                className="mt-5 w-full"
                disabled={running || batchRunning}
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
                      : `Run ${preview.executionCount} executions`}
              </Button>
            </>
          ) : (
            <>
              <div className="mt-5 flex gap-3 py-5 text-sm text-muted-foreground">
                <CircleAlert className="mt-0.5 size-4 shrink-0" />
                <div>
                  <p className="font-medium text-foreground">Complete setup to run</p>
                  <ul className="mt-2 list-disc space-y-1 pl-4 leading-6">
                    {missingRequirements.map((requirement) => (
                      <li key={requirement}>{requirement}</li>
                    ))}
                  </ul>
                </div>
              </div>
              <Button className="mt-auto w-full" disabled>
                Run evaluation
              </Button>
            </>
          )}
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
  children,
  description,
  title,
}: {
  children: React.ReactNode;
  description: string;
  title: string;
}) {
  return (
    <section className="grid gap-4 py-6 @min-[860px]:grid-cols-[11rem_minmax(0,1fr)] @min-[860px]:gap-6 xl:py-7">
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>
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

function getMissingRequirements(input: {
  cases: string[];
  configurationIds: string[];
  judges: string[];
  promptId: string;
  targetModelIds: string[];
}): string[] {
  const missing: string[] = [];
  if (!input.promptId) missing.push("Choose a prompt revision.");
  if (input.targetModelIds.length === 0) missing.push("Select at least one target model.");
  if (input.configurationIds.length === 0) missing.push("Select at least one score profile.");
  if (input.judges.length === 0) missing.push("Select at least one judge model.");
  if (input.cases.some((value) => !value.trim())) missing.push("Fill in every case input.");
  return missing.length > 0 ? missing : ["Waiting for the exact manifest to finish loading."];
}

function Definition({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="block text-xs text-muted-foreground">{label}</span>
      <span className="mt-1 block font-medium">{value}</span>
    </div>
  );
}

/** Multiplies out only the axes the user actually varied, because an axis left at one contributes nothing and reads as noise next to the ones that do. */
function describeWorkload(request: EvaluationBatchRequest | null): string {
  if (!request) return "";
  const axes = [
    [request.configurations.length, "profile"],
    [request.targetModelIds.length, "target"],
    [request.repetitions, "repetition"],
    [request.cases.length, "case"],
  ] as const;
  const varied = axes.filter(([value]) => value > 1);
  if (varied.length === 0) return "one case on one target";
  return varied.map(([value, noun]) => count(value, noun)).join(" × ");
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
