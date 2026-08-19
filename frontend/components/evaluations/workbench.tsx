/** Owns validated prompt-bound evaluation configuration, detached submission, recent attempts, and failed-run retry. */

"use client";

import { FlaskConical, LoaderCircle, Plus, RotateCcw, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/components/ui/utils";
import type { ConfiguredModel, ConfiguredModelsResponse } from "@/contracts/chat";
import type {
  Criterion,
  EvaluationRunResponse,
  EvaluationRunsResponse,
  EvaluationRunSummary,
} from "@/contracts/evaluations";
import type { PromptDetail, PromptsResponse, PromptSummary } from "@/contracts/prompts";
import type { TargetProfile, TargetProfileResponse } from "@/contracts/targets";

type CriterionDraft = {
  categories: string;
  instruction: string;
  max: string;
  min: string;
  type: Criterion["type"];
};
type CaseDraft = { criteria: CriterionDraft[]; input: string };

const NEW_CRITERION: CriterionDraft = {
  categories: "",
  instruction: "",
  max: "5",
  min: "1",
  type: "boolean",
};

export function EvaluationWorkbench({ initialPromptId }: { initialPromptId?: string }) {
  const router = useRouter();
  const [prompts, setPrompts] = useState<PromptSummary[]>([]);
  const [models, setModels] = useState<ConfiguredModel[]>([]);
  const [runs, setRuns] = useState<EvaluationRunSummary[]>([]);
  const [promptId, setPromptId] = useState("");
  const [targetModelId, setTargetModelId] = useState("");
  const [targetProfile, setTargetProfile] = useState<TargetProfile | null>();
  const [judges, setJudges] = useState<string[]>([]);
  const [cases, setCases] = useState<CaseDraft[]>([
    { input: "", criteria: [{ ...NEW_CRITERION }] },
  ]);
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      const [config, promptData, runData] = await Promise.all([
        fetchJson<ConfiguredModelsResponse>("/api/config"),
        fetchJson<PromptsResponse>("/api/prompts"),
        fetchJson<EvaluationRunsResponse>("/api/evaluations"),
      ]);
      setModels(config.models);
      setPrompts(promptData.prompts);
      setRuns(runData.runs);
      setPromptId(
        (current) =>
          current ||
          promptData.prompts.find(({ id }) => id === initialPromptId)?.id ||
          promptData.prompts[0]?.id ||
          "",
      );
      setTargetModelId((current) => current || config.models[0]?.id || "");
      setJudges((current) =>
        current.length ? current : config.models.slice(0, 1).map(({ id }) => id),
      );
    };
    load()
      .catch((error) => toast.error(readError(error)))
      .finally(() => setLoading(false));
  }, [initialPromptId]);

  useEffect(() => {
    if (!promptId) {
      setTargetProfile(undefined);
      return;
    }
    let active = true;
    setTargetProfile(undefined);
    void fetchJson<TargetProfileResponse>(`/api/targets?promptId=${encodeURIComponent(promptId)}`)
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

  function updateCase(caseIndex: number, update: (draft: CaseDraft) => CaseDraft) {
    setCases((current) =>
      current.map((draft, index) => (index === caseIndex ? update(draft) : draft)),
    );
  }

  function updateCriterion(
    caseIndex: number,
    criterionIndex: number,
    patch: Partial<CriterionDraft>,
  ) {
    updateCase(caseIndex, (draft) => ({
      ...draft,
      criteria: draft.criteria.map((criterion, index) =>
        index === criterionIndex ? { ...criterion, ...patch } : criterion,
      ),
    }));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const prompt = prompts.find(({ id }) => id === promptId);
    if (!prompt) return toast.error("Select a saved prompt.");
    if (!targetProfile) return toast.error("This prompt does not have a target runtime profile.");
    let configuredCases: Array<{ criteria: Criterion[]; input: string }>;
    try {
      configuredCases = cases.map(projectCase);
      validateCases(configuredCases);
      if (!judges.length) throw new Error("Select at least one judge model.");
    } catch (error) {
      return toast.error(readError(error));
    }
    setSubmitting(true);
    try {
      const run = await fetchJson<EvaluationRunSummary>("/api/evaluations", {
        body: JSON.stringify({
          cases: configuredCases,
          judges,
          promptId: prompt.id,
          promptRevisionId: prompt.revisionId,
          targetModelId,
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      router.push(`/evaluations/${run.id}`);
    } catch (error) {
      toast.error(readError(error));
    } finally {
      setSubmitting(false);
    }
  }

  async function retry(run: EvaluationRunSummary) {
    try {
      const [{ run: detail }, promptDetail] = await Promise.all([
        fetchJson<EvaluationRunResponse>(`/api/evaluations/${run.id}`),
        fetchJson<PromptDetail>(`/api/prompts/${run.promptId}`),
      ]);
      const retried = await fetchJson<EvaluationRunSummary>("/api/evaluations", {
        body: JSON.stringify({
          cases: detail.cases.map(({ criteria, input }) => ({ criteria, input })),
          judges: detail.judgeModelIds,
          promptId: detail.promptId,
          promptRevisionId: promptDetail.prompt.revisionId,
          targetModelId: detail.targetModelId,
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      router.push(`/evaluations/${retried.id}`);
    } catch (error) {
      toast.error(readError(error));
    }
  }

  if (loading)
    return (
      <div className="grid min-h-[60vh] place-items-center">
        <LoaderCircle
          aria-label="Loading evaluation workbench"
          className="size-5 animate-spin text-muted-foreground"
        />
      </div>
    );

  return (
    <div className="mx-auto grid w-full max-w-7xl gap-6 p-4 lg:grid-cols-[minmax(0,1fr)_22rem] sm:p-6">
      <form className="min-w-0 space-y-5" onSubmit={submit}>
        <section className="rounded-xl border bg-card p-4">
          <h2 className="font-semibold">New prompt-bound run</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            The selected current revision is frozen before target execution.
          </p>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <Field label="Saved prompt">
              <Select onChange={(event) => setPromptId(event.target.value)} value={promptId}>
                {prompts.map((prompt) => (
                  <option key={prompt.id} value={prompt.id}>
                    {prompt.title} · {prompt.revisionId.slice(0, 8)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Target model">
              <Select
                onChange={(event) => setTargetModelId(event.target.value)}
                value={targetModelId}
              >
                {models.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="mt-3 rounded-lg bg-secondary/50 px-3 py-2 text-xs">
            <span className="font-medium">Target runtime</span>
            <span className="ml-2 text-muted-foreground">
              {targetProfile === undefined
                ? "Checking configuration…"
                : targetProfile
                  ? `${targetProfile.name} · revision ${targetProfile.revisionNumber}`
                  : "Not configured for this prompt"}
            </span>
          </div>
          <fieldset className="mt-4">
            <legend className="text-sm font-medium">Judge models</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {models.map((model) => {
                const selected = judges.includes(model.id);
                return (
                  <label
                    className={cn(
                      "cursor-pointer rounded-full border px-3 py-1.5 text-xs",
                      selected && "border-primary bg-primary text-primary-foreground",
                    )}
                    key={model.id}
                  >
                    <input
                      className="sr-only"
                      checked={selected}
                      onChange={() =>
                        setJudges((current) =>
                          selected
                            ? current.filter((id) => id !== model.id)
                            : [...current, model.id],
                        )
                      }
                      type="checkbox"
                    />
                    {model.label}
                  </label>
                );
              })}
            </div>
          </fieldset>
        </section>
        {cases.map((testCase, caseIndex) => (
          <section className="rounded-xl border bg-card p-4" key={caseIndex}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold">Case {caseIndex + 1}</h3>
              {cases.length > 1 ? (
                <Button
                  aria-label={`Remove case ${caseIndex + 1}`}
                  onClick={() =>
                    setCases((current) => current.filter((_, index) => index !== caseIndex))
                  }
                  size="icon"
                  variant="ghost"
                >
                  <Trash2 aria-hidden="true" className="size-4" />
                </Button>
              ) : null}
            </div>
            <Field label="Input">
              <Textarea
                className="min-h-24"
                onChange={(event) =>
                  updateCase(caseIndex, (draft) => ({ ...draft, input: event.target.value }))
                }
                placeholder="User message sent to the frozen prompt"
                value={testCase.input}
              />
            </Field>
            <div className="mt-4 space-y-3">
              {testCase.criteria.map((criterion, criterionIndex) => (
                <CriterionEditor
                  criterion={criterion}
                  key={criterionIndex}
                  onChange={(patch) => updateCriterion(caseIndex, criterionIndex, patch)}
                  onRemove={
                    testCase.criteria.length > 1
                      ? () =>
                          updateCase(caseIndex, (draft) => ({
                            ...draft,
                            criteria: draft.criteria.filter((_, index) => index !== criterionIndex),
                          }))
                      : undefined
                  }
                />
              ))}
            </div>
            <Button
              className="mt-3"
              onClick={() =>
                updateCase(caseIndex, (draft) => ({
                  ...draft,
                  criteria: [...draft.criteria, { ...NEW_CRITERION }],
                }))
              }
              size="sm"
              variant="outline"
            >
              <Plus aria-hidden="true" className="size-3.5" />
              Add criterion
            </Button>
          </section>
        ))}
        <div className="flex flex-wrap justify-between gap-3">
          <Button
            onClick={() =>
              setCases((current) => [...current, { input: "", criteria: [{ ...NEW_CRITERION }] }])
            }
            variant="outline"
          >
            <Plus aria-hidden="true" className="size-4" />
            Add case
          </Button>
          <Button
            disabled={submitting || !prompts.length || !models.length || !targetProfile}
            type="submit"
          >
            {submitting ? (
              <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
            ) : (
              <FlaskConical aria-hidden="true" className="size-4" />
            )}
            Start evaluation
          </Button>
        </div>
      </form>
      <aside>
        <h2 className="mb-3 text-sm font-semibold">Recent runs</h2>
        {runs.length === 0 ? (
          <div className="rounded-xl border border-dashed p-5 text-sm text-muted-foreground">
            No persisted evaluation attempts yet.
          </div>
        ) : (
          <div className="space-y-2">
            {runs.map((run) => (
              <div className="rounded-xl border bg-card p-3" key={run.id}>
                <div className="flex items-start justify-between gap-2">
                  <Link
                    className="min-w-0 font-medium hover:underline"
                    href={`/evaluations/${run.id}`}
                  >
                    <span className="line-clamp-2 text-sm">{run.promptTitle}</span>
                  </Link>
                  <Status status={run.status} />
                </div>
                <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                  <div>
                    {run.caseCount} {run.caseCount === 1 ? "case" : "cases"} ·{" "}
                    {run.judgeModelIds.length} {run.judgeModelIds.length === 1 ? "judge" : "judges"}
                  </div>
                  <div className="truncate">
                    {run.targetProfileName ?? "Legacy runtime"} · {run.targetModelId}
                  </div>
                  <div>
                    {run.source === "ai" ? "AI" : "Human"} · revision{" "}
                    {run.promptRevisionId.slice(0, 8)}
                  </div>
                  <div>{formatDate(run.completedAt ?? run.createdAt)}</div>
                </div>
                {run.status === "failed" || run.status === "interrupted" ? (
                  <Button
                    className="mt-2"
                    onClick={() => void retry(run)}
                    size="sm"
                    variant="outline"
                  >
                    <RotateCcw aria-hidden="true" className="size-3.5" />
                    Retry on current revision
                  </Button>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </aside>
    </div>
  );
}

function CriterionEditor({
  criterion,
  onChange,
  onRemove,
}: {
  criterion: CriterionDraft;
  onChange(patch: Partial<CriterionDraft>): void;
  onRemove?: () => void;
}) {
  return (
    <div className="rounded-lg bg-secondary/50 p-3">
      <div className="grid gap-2 sm:grid-cols-[10rem_1fr_auto]">
        <Select
          aria-label="Criterion type"
          onChange={(event) => onChange({ type: event.target.value as Criterion["type"] })}
          value={criterion.type}
        >
          <option value="boolean">Boolean</option>
          <option value="categorical">Categorical</option>
          <option value="numeric">Numeric</option>
          <option value="text">Text</option>
          <option value="correction">Correction</option>
        </Select>
        <Input
          aria-label="Criterion instruction"
          onChange={(event) => onChange({ instruction: event.target.value })}
          placeholder="What should the judge assess?"
          value={criterion.instruction}
        />
        {onRemove ? (
          <Button aria-label="Remove criterion" onClick={onRemove} size="icon" variant="ghost">
            <Trash2 aria-hidden="true" className="size-4" />
          </Button>
        ) : (
          <span />
        )}
      </div>
      {criterion.type === "categorical" ? (
        <Input
          className="mt-2"
          onChange={(event) => onChange({ categories: event.target.value })}
          placeholder="Categories, comma separated"
          value={criterion.categories}
        />
      ) : null}
      {criterion.type === "numeric" ? (
        <div className="mt-2 grid grid-cols-2 gap-2">
          <Input
            aria-label="Minimum score"
            onChange={(event) => onChange({ min: event.target.value })}
            type="number"
            value={criterion.min}
          />
          <Input
            aria-label="Maximum score"
            onChange={(event) => onChange({ max: event.target.value })}
            type="number"
            value={criterion.max}
          />
        </div>
      ) : null}
    </div>
  );
}

function Field({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <label className="block text-sm font-medium">
      {label}
      <div className="mt-1">{children}</div>
    </label>
  );
}

function Status({ status }: { status: EvaluationRunSummary["status"] }) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium capitalize",
        status === "completed" && "bg-chart-2/15 text-chart-2",
        status === "running" && "bg-chart-4/20 text-foreground",
        (status === "failed" || status === "interrupted") && "bg-destructive/10 text-destructive",
      )}
    >
      {status}
    </span>
  );
}

function projectCase(draft: CaseDraft): { criteria: Criterion[]; input: string } {
  return {
    input: draft.input.trim(),
    criteria: draft.criteria.map((criterion) => {
      const instruction = criterion.instruction.trim();
      if (criterion.type === "categorical")
        return {
          type: "categorical",
          instruction,
          categories: criterion.categories
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean),
        };
      if (criterion.type === "numeric")
        return {
          type: "numeric",
          instruction,
          min: Number(criterion.min),
          max: Number(criterion.max),
        };
      return { type: criterion.type, instruction };
    }),
  };
}

function validateCases(cases: Array<{ criteria: Criterion[]; input: string }>) {
  for (const [caseIndex, testCase] of cases.entries()) {
    if (!testCase.input) throw new Error(`Case ${caseIndex + 1} input is required.`);
    if (testCase.criteria.some(({ instruction }) => !instruction))
      throw new Error(`Case ${caseIndex + 1} criterion instructions are required.`);
    if (testCase.criteria.filter(({ type }) => type === "correction").length > 1)
      throw new Error(`Case ${caseIndex + 1} may contain at most one correction criterion.`);
    for (const criterion of testCase.criteria) {
      if (
        criterion.type === "categorical" &&
        (criterion.categories.length < 2 ||
          new Set(criterion.categories).size !== criterion.categories.length)
      )
        throw new Error(
          `Case ${caseIndex + 1} categorical criteria require at least two unique categories.`,
        );
      if (
        criterion.type === "numeric" &&
        (!Number.isFinite(criterion.min) ||
          !Number.isFinite(criterion.max) ||
          criterion.min >= criterion.max)
      )
        throw new Error(`Case ${caseIndex + 1} numeric minimum must be below its maximum.`);
    }
  }
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(value),
  );
}

async function fetchJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, { cache: "no-store", ...init });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: unknown };
    throw new Error(typeof body.error === "string" ? body.error : "Evaluation request failed.");
  }
  return (await response.json()) as T;
}

function readError(error: unknown): string {
  return error instanceof Error ? error.message : "Evaluation request failed.";
}
