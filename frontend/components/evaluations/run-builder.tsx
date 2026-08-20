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
  Sparkles,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { ModelIdentityLabel } from "@/components/chat/model-selector";
import { CriterionTypeIcon } from "@/components/evaluations/criterion-type-icon";
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

type SavedConfiguration = {
  cases: string[];
  configurationIds: string[];
  judges: string[];
  name: string;
  repetitions: number;
  targetModelIds: string[];
};

type LastRunConfiguration = Omit<SavedConfiguration, "name"> & {
  caseMode: CaseMode;
  caseSeeds: string;
  generatedCaseCount: number;
  promptId: string;
};

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
type CaseMode = "generate" | "manual";

export function EvaluationRunBuilder() {
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
  const [caseMode, setCaseMode] = useState<CaseMode>("manual");
  const [caseSeeds, setCaseSeeds] = useState("");
  const [generatedCaseCount, setGeneratedCaseCount] = useState(3);
  const [preview, setPreview] = useState<EvaluationBatchPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [running, setRunning] = useState(false);
  const [startedRuns, setStartedRuns] = useState<EvaluationRunSummary[]>([]);
  const [savedConfigurations, setSavedConfigurations] = useState<SavedConfiguration[]>([]);
  const [savedName, setSavedName] = useState("");
  const [runStateReady, setRunStateReady] = useState(false);
  const [trackedBatch, setTrackedBatch] = useState<TrackedBatch | null>(null);
  const batchRunIds = startedRuns.map(({ id }) => id).join(",");
  const selectedPrompt = prompts.find(({ id }) => id === promptId);
  const request = useMemo(
    () =>
      selectedPrompt && caseMode === "manual"
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
    [
      caseMode,
      cases,
      configurationIds,
      judges,
      profiles,
      repetitions,
      selectedPrompt,
      targetModelIds,
    ],
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
          setCaseMode(lastRun.caseMode);
          setCaseSeeds(lastRun.caseSeeds);
          setGeneratedCaseCount(lastRun.generatedCaseCount);
        }
        if (lastBatch) {
          setTrackedBatch(lastBatch);
          void fetchBatchStatus(lastBatch.runIds)
            .then(({ runs }) => setStartedRuns(runs))
            .catch((error) => toast.error(readError(error)));
        }
        setRunStateReady(true);
      })
      .catch((error) => toast.error(readError(error)));
    setSavedConfigurations(readSavedConfigurations());
  }, []);

  useEffect(() => {
    if (!runStateReady) return;
    const lastRun: LastRunConfiguration = {
      caseMode,
      cases,
      caseSeeds,
      configurationIds,
      generatedCaseCount,
      judges,
      promptId,
      repetitions,
      targetModelIds,
    };
    window.localStorage.setItem(LAST_RUN_STORAGE_KEY, JSON.stringify(lastRun));
  }, [
    caseMode,
    cases,
    caseSeeds,
    configurationIds,
    generatedCaseCount,
    judges,
    promptId,
    repetitions,
    runStateReady,
    targetModelIds,
  ]);

  useEffect(() => {
    if (!request || !batchRunIds || trackedBatch) return;
    const recoveredBatch = { request, runIds: batchRunIds.split(",") };
    window.localStorage.setItem(TRACKED_BATCH_STORAGE_KEY, JSON.stringify(recoveredBatch));
    setTrackedBatch(recoveredBatch);
  }, [batchRunIds, request, trackedBatch]);

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
    const tracksCurrentRequest = Boolean(
      request && trackedBatch && sameBatchRequest(request, trackedBatch.request),
    );
    if (!tracksCurrentRequest) {
      setStartedRuns([]);
      if (trackedBatch) {
        window.localStorage.removeItem(TRACKED_BATCH_STORAGE_KEY);
        setTrackedBatch(null);
      }
    }
    if (
      !request ||
      !targetProfile ||
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
  }, [request, targetProfile, trackedBatch]);

  useEffect(() => {
    if (!batchRunIds) return;
    let active = true;
    let timer: number | undefined;
    const runIds = batchRunIds.split(",");
    const refresh = async () => {
      try {
        const result = await fetchBatchStatus(runIds);
        if (!active) return;
        setStartedRuns(result.runs);
        if (result.runs.every(({ status }) => TERMINAL_STATUSES.has(status)) && timer) {
          window.clearInterval(timer);
        }
      } catch (error) {
        if (active) {
          if (timer) window.clearInterval(timer);
          toast.error(readError(error));
        }
      }
    };
    timer = window.setInterval(() => void refresh(), 1500);
    void refresh();
    return () => {
      active = false;
      if (timer) window.clearInterval(timer);
    };
  }, [batchRunIds]);

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

  function saveConfiguration() {
    const name = savedName.trim();
    if (!name) return toast.error("Name this configuration before saving it.");
    const next = [
      ...savedConfigurations.filter((configuration) => configuration.name !== name),
      { cases, configurationIds, judges, name, repetitions, targetModelIds },
    ];
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    setSavedConfigurations(next);
    setSavedName("");
    toast.success(`Saved “${name}” in this browser.`);
  }

  function loadConfiguration(value: string) {
    const saved = savedConfigurations.find(({ name }) => name === value);
    if (!saved) return;
    setCaseMode("manual");
    setCases(saved.cases);
    setConfigurationIds(
      saved.configurationIds.filter((id) => profiles.some((profile) => profile.id === id)),
    );
    setJudges(saved.judges.filter((id) => models.some((model) => model.id === id)));
    setRepetitions(saved.repetitions);
    setTargetModelIds(saved.targetModelIds.filter((id) => models.some((model) => model.id === id)));
  }

  const finishedRuns = startedRuns.filter(({ status }) => TERMINAL_STATUSES.has(status)).length;
  const completedRuns = startedRuns.filter(({ status }) => status === "completed").length;
  const failedRuns = startedRuns.filter(
    ({ status }) => status === "failed" || status === "interrupted",
  ).length;
  const runningRuns = startedRuns.filter(({ status }) => status === "running").length;
  const progress = preview ? Math.round((finishedRuns / preview.executionCount) * 100) : 0;
  const batchFinished = Boolean(
    preview && startedRuns.length > 0 && finishedRuns === preview.executionCount,
  );

  return (
    <div className="mx-auto grid w-full max-w-[1480px] grid-cols-1 bg-muted/15 lg:grid-cols-[minmax(0,1fr)_20rem] xl:grid-cols-[minmax(0,1fr)_25rem]">
      <section className="min-w-0 bg-background px-4 py-5 sm:px-6 lg:border-r xl:px-10 xl:py-8">
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
          description="Pin one current prompt revision and its deployed target profile."
          title="Target"
        >
          <Field label="Prompt">
            <Select onChange={(event) => setPromptId(event.target.value)} value={promptId}>
              <option value="">Choose a prompt revision</option>
              {prompts.map((prompt) => (
                <option key={prompt.id} value={prompt.id}>
                  {prompt.title} · V{prompt.revisionNumber}
                </option>
              ))}
            </Select>
          </Field>
          <div className="grid gap-3 py-2 text-sm sm:grid-cols-2">
            <Definition
              label="Target profile"
              value={
                targetProfile === undefined ? "Loading…" : (targetProfile?.name ?? "Not configured")
              }
            />
            <Definition
              label="Runtime"
              value={
                targetProfile
                  ? `${targetProfile.configuration.maxSteps} steps · ${targetProfile.configuration.tools.length ? targetProfile.configuration.tools.join(", ") : "no tools"}`
                  : "—"
              }
            />
          </div>
          <ModelPicker
            label="Target models"
            models={models}
            selected={targetModelIds}
            setSelected={setTargetModelIds}
          />
        </RunSection>

        <RunSection
          description="Each selected profile becomes an independent execution lane."
          title="Score profiles"
        >
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">
              {configurationIds.length} selected
            </span>
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
          </div>
          <div className="max-h-64 overflow-auto border">
            <table className="w-full table-fixed text-left text-xs">
              <thead className="sticky top-0 z-10 bg-background text-[10px] text-muted-foreground">
                <tr className="border-b">
                  <th className="w-10 px-3 py-2 font-medium" scope="col">
                    Use
                  </th>
                  <th className="w-[32%] px-2 py-2 font-medium" scope="col">
                    Profile
                  </th>
                  <th className="px-2 py-2 font-medium" scope="col">
                    Criteria preview
                  </th>
                  <th className="w-16 px-3 py-2 text-right font-medium" scope="col">
                    Count
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {profiles.map((profile) => {
                  const selected = configurationIds.includes(profile.id);
                  return (
                    <tr className={cn(selected && "bg-accent/60")} key={profile.id}>
                      <td className="px-3 py-2.5 align-top">
                        <input
                          aria-label={`Use ${profile.name}`}
                          checked={selected}
                          className="size-4 accent-foreground"
                          onChange={() => setConfigurationIds(toggle(configurationIds, profile.id))}
                          type="checkbox"
                        />
                      </td>
                      <th className="px-2 py-2.5 align-top font-medium" scope="row">
                        <button
                          className="text-left hover:underline"
                          onClick={() => setConfigurationIds(toggle(configurationIds, profile.id))}
                          type="button"
                        >
                          {profile.name}
                        </button>
                      </th>
                      <td className="px-2 py-2.5 align-top leading-relaxed text-muted-foreground">
                        <span className="line-clamp-2">
                          {profile.criteria.map((criterion, index) => (
                            <span className="mr-2 inline-flex items-center gap-1" key={index}>
                              <CriterionTypeIcon type={criterion.type} />
                              {criterion.instruction.split(" — ")[0]}
                            </span>
                          ))}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right align-top font-mono text-[10px] text-muted-foreground">
                        {profile.criteria.length}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </RunSection>

        <RunSection
          description="Every judge scores every criterion for every case in an execution."
          title="Judges"
        >
          <ModelPicker
            label="Judge models"
            models={models}
            selected={judges}
            setSelected={setJudges}
          />
        </RunSection>

        <RunSection
          description="These inputs run once inside every profile, model, and repetition combination."
          title="Cases"
        >
          <div
            className="inline-grid grid-cols-2 border p-1"
            role="group"
            aria-label="Case input mode"
          >
            <button
              aria-pressed={caseMode === "manual"}
              className={cn(
                "h-8 px-3 text-xs font-medium transition-colors",
                caseMode === "manual"
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground",
              )}
              onClick={() => setCaseMode("manual")}
              type="button"
            >
              Manual inputs
            </button>
            <button
              aria-pressed={caseMode === "generate"}
              className={cn(
                "flex h-8 items-center justify-center gap-1.5 px-3 text-xs font-medium transition-colors",
                caseMode === "generate"
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground",
              )}
              onClick={() => setCaseMode("generate")}
              type="button"
            >
              <Sparkles aria-hidden="true" className="size-3.5" />
              Generate inputs
            </button>
          </div>
          {caseMode === "manual" ? (
            <>
              <div className="mt-4 divide-y">
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
            </>
          ) : (
            <div className="mt-4">
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_8rem]">
                <Field label="Themes or sparse phrases">
                  <Textarea
                    className="min-h-24 shadow-none"
                    onChange={(event) => setCaseSeeds(event.target.value)}
                    placeholder="Optional; one theme or key phrase per line. Leave blank for freestyle inputs."
                    value={caseSeeds}
                  />
                </Field>
                <Field label="Input count">
                  <Input
                    max={10}
                    min={1}
                    onChange={(event) =>
                      setGeneratedCaseCount(
                        Math.max(1, Math.min(10, Number(event.target.value) || 1)),
                      )
                    }
                    type="number"
                    value={generatedCaseCount}
                  />
                </Field>
              </div>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">
                Generation will use the pinned prompt, deployed target runtime, selected score
                profiles, and these optional themes.
              </p>
              <div className="mt-3 border">
                <div className="flex items-center justify-between gap-3 border-b px-3 py-2">
                  <span className="text-xs font-medium">Generated input preview</span>
                  <span className="font-mono text-[10px] text-muted-foreground">
                    0 of {generatedCaseCount} ready
                  </span>
                </div>
                <div className="px-3 py-5 text-xs leading-5 text-muted-foreground">
                  Generated inputs will appear here for review and editing before the matrix can
                  run.
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <Button disabled size="sm">
                  <Sparkles aria-hidden="true" className="size-3.5" />
                  Generate inputs
                </Button>
                <span className="text-[11px] text-muted-foreground">
                  Waiting for the evaluation LangGraph generation node.
                </span>
              </div>
            </div>
          )}
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

      <aside className="border-t bg-muted/35 lg:border-t-0">
        <div className="px-4 py-5 sm:px-6 lg:px-5 xl:px-6 xl:py-8">
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
              <div className="mt-5 grid grid-cols-3 rounded-xl bg-background/70 px-3 py-3 text-center">
                <ManifestMetric label="Runs" value={preview.executionCount} />
                <ManifestMetric label="Outputs" value={preview.targetCaseInvocations} />
                <ManifestMetric label="Judges" value={request?.judges.length ?? 0} />
              </div>
              <p className="mt-3 text-xs leading-5 text-muted-foreground">
                {request?.configurations.length} profiles × {request?.targetModelIds.length} targets
                × {request?.repetitions} repetitions = {preview.executionCount} durable runs.
              </p>
              <div className="mt-5 rounded-xl bg-background/60 p-4">
                <div className="flex items-end justify-between gap-3">
                  <div>
                    <span className="block text-xs font-semibold">Batch progress</span>
                    <span className="mt-1 block text-[11px] text-muted-foreground">
                      {startedRuns.length === 0
                        ? `Ready · 0 of ${preview.executionCount} finished`
                        : `${finishedRuns} of ${preview.executionCount} finished`}
                    </span>
                  </div>
                  <strong className="font-mono text-lg font-semibold">{progress}%</strong>
                </div>
                <div
                  aria-label="Evaluation batch progress"
                  aria-valuemax={preview.executionCount}
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
                <div className="mt-3 grid grid-cols-3 gap-2 text-[10px] text-muted-foreground">
                  <span>
                    <strong className="font-mono text-foreground">{completedRuns}</strong> completed
                  </span>
                  <span className="text-center">
                    <strong className="font-mono text-foreground">{runningRuns}</strong> running
                  </span>
                  <span className="text-right">
                    <strong
                      className={cn(
                        "font-mono",
                        failedRuns > 0 ? "text-destructive" : "text-foreground",
                      )}
                    >
                      {failedRuns}
                    </strong>{" "}
                    failed
                  </span>
                </div>
              </div>
              <div className="mt-5 divide-y">
                {preview.jobs.slice(0, 200).map((job) => {
                  const started = startedRuns[job.executionNumber - 1];
                  return (
                    <div
                      className="grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-2 py-1.5 text-xs"
                      key={job.id}
                    >
                      <span className="font-mono text-[10px] text-muted-foreground">
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
                      {started ? (
                        <Link
                          className="inline-flex items-center gap-1 font-medium hover:underline"
                          href={`/evaluations/${started.id}`}
                        >
                          {statusLabel(started.status)}
                          <ChevronRight className="size-3" />
                        </Link>
                      ) : null}
                    </div>
                  );
                })}
              </div>
              {preview.jobs.length > 200 && (
                <p className="mt-3 text-xs text-muted-foreground">
                  Showing the first 200 of {preview.jobs.length} executions. All executions will
                  run.
                </p>
              )}
              <Button
                className="mt-5 w-full"
                disabled={running || (startedRuns.length > 0 && !batchFinished)}
                onClick={startBatch}
              >
                {running ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : batchFinished ? (
                  <RotateCcw className="size-4" />
                ) : startedRuns.length ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : null}
                {running
                  ? "Starting matrix…"
                  : batchFinished
                    ? "Run matrix again"
                    : startedRuns.length
                      ? `Running ${runningRuns} of ${preview.executionCount}`
                      : `Run ${preview.executionCount} executions`}
              </Button>
            </>
          ) : (
            <div className="mt-5 flex gap-3 py-5 text-sm text-muted-foreground">
              <CircleAlert className="mt-0.5 size-4 shrink-0" />
              <p className="leading-6">
                {caseMode === "generate"
                  ? "Generate and review the requested inputs before the exact execution manifest is expanded."
                  : "Complete the target, score profile, judge, and case settings to generate the exact manifest."}
              </p>
            </div>
          )}
        </div>
      </aside>
    </div>
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
    <section className="grid gap-4 py-6 min-[1180px]:grid-cols-[11rem_minmax(0,1fr)] min-[1180px]:gap-6 xl:py-7">
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

function Definition({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="block text-xs text-muted-foreground">{label}</span>
      <span className="mt-1 block font-medium">{value}</span>
    </div>
  );
}

function ModelPicker({
  label,
  models,
  selected,
  setSelected,
}: {
  label: string;
  models: ConfiguredModel[];
  selected: string[];
  setSelected(value: string[]): void;
}) {
  return (
    <fieldset className="mt-4">
      <legend className="mb-2 text-xs font-medium">{label}</legend>
      <div className="flex flex-wrap gap-2">
        {models.map((model) => {
          const active = selected.includes(model.id);
          return (
            <button
              aria-pressed={active}
              className={cn(
                "inline-flex h-6 items-center justify-center rounded-full border px-2 text-[10px] transition-colors",
                active
                  ? "border-foreground bg-foreground text-background"
                  : "bg-background hover:bg-accent",
              )}
              key={model.id}
              onClick={() => setSelected(toggle(selected, model.id))}
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

function ManifestMetric({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <strong className="block font-mono text-lg font-semibold">{value.toLocaleString()}</strong>
      <span className="mt-0.5 block text-[10px] text-muted-foreground">{label}</span>
    </div>
  );
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

function toggle(values: string[], value: string): string[] {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
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
