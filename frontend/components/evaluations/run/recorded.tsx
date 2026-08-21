/** Configures judge-only evaluation of one completed Target Run turn while preserving its immutable trace provenance. */

"use client";

import {
  CheckCircle2,
  FlaskConical,
  LoaderCircle,
  MessageSquareText,
  TriangleAlert,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { ResponseText } from "@/components/chat/elements/response";
import { ModelIdentityLabel } from "@/components/chat/model-selector";
import { projectCompletedTargetTrace } from "@/components/chat/target/messages";
import {
  CriteriaProfilePicker,
  EvaluationModelPicker,
} from "@/components/evaluations/run/selectors";
import { Button } from "@/components/ui/button";
import type { ConfiguredModel, ConfiguredModelsResponse } from "@/contracts/chat";
import type {
  CriteriaProfile,
  CriteriaProfilesResponse,
  EvaluationRunSummary,
} from "@/contracts/evaluations";
import type { TargetRun, TargetRunResponse } from "@/contracts/target-runs";
import { createApiRequester, createErrorReader } from "@/shared/api";

const api = createApiRequester({ cache: "no-store" });
const readError = createErrorReader("The recorded evaluation request failed.");

export function RecordedEvaluationBuilder({
  targetRunId,
  targetRunTurnId,
}: {
  targetRunId: string;
  targetRunTurnId: string;
}) {
  const [run, setRun] = useState<TargetRun>();
  const [models, setModels] = useState<ConfiguredModel[]>([]);
  const [profiles, setProfiles] = useState<CriteriaProfile[]>([]);
  const [profileIds, setProfileIds] = useState<string[]>([]);
  const [judgeIds, setJudgeIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [source, setSource] = useState(false);
  const [evaluations, setEvaluations] = useState<
    Array<{ profileName: string; run: EvaluationRunSummary }>
  >([]);
  const turn = run?.turns.find(({ id }) => id === targetRunTurnId);
  const selectedProfiles = profiles.filter(({ id }) => profileIds.includes(id));
  const criterionCount = selectedProfiles.reduce(
    (total, profile) => total + profile.criteria.length,
    0,
  );
  const judgeDecisionCount = criterionCount * judgeIds.length;
  const trace = useMemo(() => projectCompletedTargetTrace(run, turn), [run, turn]);

  useEffect(() => {
    Promise.all([
      api.json<TargetRunResponse>(`/api/target-runs/${encodeURIComponent(targetRunId)}`),
      api.json<ConfiguredModelsResponse>("/api/config"),
      api.json<CriteriaProfilesResponse>("/api/evaluations/criteria-profiles"),
    ])
      .then(([targetData, config, profileData]) => {
        setRun(targetData.run);
        setModels(config.models);
        setProfiles(profileData.profiles);
      })
      .catch((cause) => toast.error(readError(cause)))
      .finally(() => setLoading(false));
  }, [targetRunId]);

  async function start() {
    if (!selectedProfiles.length || !judgeIds.length || !turn) return;
    setStarting(true);
    try {
      const results = await Promise.all(
        selectedProfiles.map(async (profile) => ({
          profileName: profile.name,
          run: await api.json<EvaluationRunSummary>("/api/evaluations/recorded", {
            body: JSON.stringify({
              criteria: profile.criteria,
              judges: judgeIds,
              targetRunId,
              targetRunTurnId,
            }),
            headers: { "content-type": "application/json" },
            method: "POST",
          }),
        })),
      );
      setEvaluations(results);
      toast.success(
        `Started ${results.length} recorded ${results.length === 1 ? "evaluation" : "evaluations"}.`,
      );
    } catch (cause) {
      toast.error(readError(cause));
    } finally {
      setStarting(false);
    }
  }

  if (loading) {
    return (
      <div className="grid min-h-[60vh] place-items-center">
        <LoaderCircle
          aria-label="Loading recorded Target Run"
          className="size-5 animate-spin text-muted-foreground"
        />
      </div>
    );
  }

  if (!run || !turn) {
    return (
      <div className="grid min-h-[60vh] place-items-center px-6 text-center">
        <div>
          <TriangleAlert aria-hidden="true" className="mx-auto size-7 text-destructive" />
          <h2 className="mt-3 text-lg font-semibold">Recorded turn unavailable</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Return to the Target Run and choose a completed turn.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto grid w-full max-w-6xl gap-6 px-4 py-6 lg:grid-cols-[minmax(0,1fr)_24rem] lg:px-8 lg:py-8">
      <section className="min-w-0">
        <div className="flex items-start gap-3">
          <div className="grid size-9 shrink-0 place-items-center rounded-lg border bg-muted/30">
            <MessageSquareText aria-hidden="true" className="size-4" />
          </div>
          <div>
            <h2 className="text-xl font-semibold">Evaluate recorded Target trace</h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              Judge the saved response exactly as observed. The AI SDK Target will not run again.
            </p>
          </div>
        </div>
        <div className="mt-6 border bg-background">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b bg-muted/20 px-4 py-3 text-xs">
            <span className="font-semibold">{run.promptTitle}</span>
            <span className="text-muted-foreground">v{run.promptRevisionNumber}</span>
            <span className="text-muted-foreground">{run.targetProfileName}</span>
            <ModelIdentityLabel
              className="text-muted-foreground"
              model={models.find(({ id }) => id === run.targetModelId)}
              modelId={run.targetModelId}
            />
            <div className="ml-auto flex items-center gap-2">
              <Button onClick={() => setSource((value) => !value)} size="sm" variant="ghost">
                {source ? "Preview" : "Source"}
              </Button>
              <Link className="font-medium hover:underline" href={`/target-runs/${run.id}`}>
                Open Target Run
              </Link>
            </div>
          </div>
          <div className="divide-y">
            {trace.map((message, index) => (
              <div className="grid gap-1 px-4 py-3 sm:grid-cols-[5rem_minmax(0,1fr)]" key={index}>
                <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {message.role}
                </span>
                {!source && message.role === "assistant" ? (
                  <ResponseText text={message.content} />
                ) : (
                  <div className="whitespace-pre-wrap break-words text-sm leading-6">
                    {message.content}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>
      <aside className="h-fit border bg-background p-4 lg:sticky lg:top-4">
        <h3 className="text-sm font-semibold">Judge configuration</h3>
        <CriteriaProfilePicker
          className="mt-4"
          onChange={setProfileIds}
          profiles={profiles}
          selected={profileIds}
        />
        <EvaluationModelPicker
          className="mt-4"
          label="Judge models"
          models={models}
          onChange={setJudgeIds}
          selected={judgeIds}
        />
        <div className="mt-5 border-t pt-4">
          <h4 className="text-xs font-semibold">Preview</h4>
          <div className="mt-3 space-y-2 text-xs text-muted-foreground">
            <div className="flex justify-between gap-3">
              <span>Evaluation runs</span>
              <strong className="font-mono text-foreground">{selectedProfiles.length}</strong>
            </div>
            <div className="flex justify-between gap-3">
              <span>Criteria</span>
              <strong className="font-mono text-foreground">{criterionCount}</strong>
            </div>
            <div className="flex justify-between gap-3">
              <span>Judges</span>
              <strong className="font-mono text-foreground">{judgeIds.length}</strong>
            </div>
          </div>
        </div>
        <div className="mt-4 border-t pt-4 text-xs text-muted-foreground">
          <div className="flex justify-between gap-3">
            <span>Target invocations</span>
            <strong className="font-mono text-foreground">0</strong>
          </div>
          <div className="mt-2 flex justify-between gap-3">
            <span>Judge decisions</span>
            <strong className="font-mono text-foreground">{judgeDecisionCount}</strong>
          </div>
        </div>
        <Button
          className="mt-5 w-full"
          disabled={
            !selectedProfiles.length || !judgeIds.length || starting || turn.status !== "completed"
          }
          onClick={() => void start()}
        >
          {starting ? (
            <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
          ) : (
            <FlaskConical aria-hidden="true" className="size-4" />
          )}
          Evaluate saved response
        </Button>
        {evaluations.length ? (
          <div className="mt-3 divide-y border-t">
            {evaluations.map(({ profileName, run: evaluation }) => (
              <Link
                className="flex items-center gap-2 py-2 text-xs font-medium hover:underline"
                href={`/evaluations/${evaluation.id}`}
                key={evaluation.id}
              >
                <CheckCircle2 aria-hidden="true" className="size-4 shrink-0" />
                <span className="min-w-0 flex-1 truncate">{profileName}</span>
                <span className="text-muted-foreground">Open</span>
              </Link>
            ))}
          </div>
        ) : null}
      </aside>
    </div>
  );
}
