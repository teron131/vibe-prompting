/** Reloads one Scenario, presents its public Target conversation, and links automatic evaluation outcomes. */

"use client";

import { ArrowLeft, ChevronRight, LoaderCircle, RotateCcw, Square } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { ModelIdentityLabel } from "@/components/chat/model-selector";
import { EvaluationPageBar } from "@/components/evaluations/shared/evaluation-page-bar";
import { Button } from "@/components/ui/button";
import {
  isScenarioActive,
  isScenarioEvaluationActive,
  type ScenarioRunResponse,
} from "@/contracts/scenario-runs";
import { createApiRequester, createErrorReader } from "@/shared/api";
import { formatDateTime } from "@/shared/date";

const scenarioApi = createApiRequester({ cache: "no-store" }, "Scenario request failed.");
const readError = createErrorReader("Scenario request failed.");

export function ScenarioReport({ runId }: { runId: string }) {
  const [response, setResponse] = useState<ScenarioRunResponse>();
  const [error, setError] = useState<string>();
  const [stopping, setStopping] = useState(false);
  const runActive = response ? isScenarioActive(response) : false;
  const evaluationsActive = response ? isScenarioEvaluationActive(response) : false;
  const load = useCallback(async () => {
    const next = await scenarioApi.json<ScenarioRunResponse>(`/api/scenario-runs/${runId}`);
    setResponse(next);
    setError(undefined);
    return next;
  }, [runId]);

  useEffect(() => {
    void load().catch((cause) => setError(readError(cause)));
  }, [load]);
  useEffect(() => {
    if (!runActive && !evaluationsActive) return;
    let active = true;
    let polling = false;
    let timer: number | undefined;
    const intervalMs = 1500;
    const schedule = (delay = intervalMs) => {
      if (!active || document.hidden) return;
      timer = window.setTimeout(() => {
        timer = undefined;
        void poll();
      }, delay);
    };
    const poll = async () => {
      if (polling || document.hidden) return;
      polling = true;
      const startedAt = performance.now();
      try {
        const next = await load();
        if (active && (isScenarioActive(next) || isScenarioEvaluationActive(next))) {
          schedule(Math.max(0, intervalMs - (performance.now() - startedAt)));
        }
      } catch (cause) {
        if (active) setError(readError(cause));
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
      void poll();
    };
    schedule();
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      active = false;
      if (timer !== undefined) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [evaluationsActive, load, runActive]);

  async function stop() {
    setStopping(true);
    try {
      const next = await scenarioApi.json<ScenarioRunResponse>(`/api/scenario-runs/${runId}`, {
        method: "PATCH",
      });
      setResponse(next);
      setError(undefined);
    } catch (cause) {
      setError(readError(cause));
    } finally {
      setStopping(false);
    }
  }

  if (!response) {
    return (
      <div className="mx-auto flex min-h-[24rem] max-w-5xl items-center justify-center p-6">
        {error ? (
          <div className="text-center">
            <p className="text-sm text-destructive">{error}</p>
            <Button className="mt-4" onClick={() => void load()} variant="outline">
              <RotateCcw className="size-4" /> Retry
            </Button>
          </div>
        ) : (
          <LoaderCircle
            aria-label="Loading Scenario"
            className="size-5 animate-spin text-muted-foreground"
          />
        )}
      </div>
    );
  }

  const { evaluations, scenario, target } = response;
  return (
    <div className="mx-auto min-h-[calc(100dvh-var(--header-height))] w-full max-w-5xl">
      <EvaluationPageBar sticky>
        <Link
          className="inline-flex items-center gap-1 text-xs font-medium hover:underline"
          href="/evaluations/run"
        >
          <ArrowLeft className="size-3.5" /> Evaluation Run
        </Link>
        <span className="text-xs text-muted-foreground">/</span>
        <h1 className="min-w-0 truncate text-sm font-semibold">
          Scenario {scenario.id.slice(0, 8)}
        </h1>
        {runActive ? (
          <Button
            className="ml-auto"
            disabled={stopping}
            onClick={stop}
            size="sm"
            variant="outline"
          >
            {stopping ? (
              <LoaderCircle className="size-3.5 animate-spin" />
            ) : (
              <Square className="size-3.5" />
            )}{" "}
            Stop
          </Button>
        ) : null}
      </EvaluationPageBar>

      <div className="px-4 py-6 sm:px-6">
        {error ? <p className="mb-5 border-y py-3 text-sm text-destructive">{error}</p> : null}
        {scenario.errorMessage ? (
          <p className="mb-5 border-y py-3 text-sm text-destructive">{scenario.errorMessage}</p>
        ) : null}
        <section className="grid divide-y border-y text-xs sm:grid-cols-2 sm:divide-x sm:divide-y-0">
          <ScenarioFact label="State" value={scenarioStatus(response)} />
          <ScenarioFact
            label="Prompt"
            value={`${scenario.promptTitle} · v${scenario.promptRevisionNumber}`}
          />
          <ScenarioFact label="Target Model" value={scenario.targetModel} />
          {scenario.mode === "generative" ? (
            <ScenarioFact label="Driver Model" value={scenario.driverModel} />
          ) : null}
          <ScenarioFact label="Target Reasoning" value={scenario.reasoningEffort} />
          <ScenarioFact
            label="Method"
            value={
              scenario.mode === "generative"
                ? `Generative · max ${scenario.maxTurns} turns`
                : `Static · ${scenario.messages.length} turns`
            }
          />
          <ScenarioFact label="Started" value={formatDateTime(scenario.createdAt)} />
          <ScenarioFact
            label="Stop Reason"
            value={scenario.stopReason ?? (runActive ? "In progress" : "—")}
          />
        </section>

        <section className="border-b py-6">
          <h2 className="text-sm font-semibold">Scenario Definition</h2>
          {scenario.mode === "generative" ? (
            <div className="mt-4 grid gap-5 md:grid-cols-2">
              <ScenarioText label="Instruction" value={scenario.instruction} />
              <ScenarioText
                label="Driver Brief"
                value={scenario.driverBrief ?? "Generated when the Scenario starts."}
              />
            </div>
          ) : (
            <ol className="mt-4 divide-y border-y">
              {scenario.messages.map((message, index) => (
                <li
                  className="grid grid-cols-[3rem_minmax(0,1fr)] gap-3 py-3 text-sm"
                  key={`${index}-${message}`}
                >
                  <span className="px-3 font-mono text-[11px] text-muted-foreground">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span className="whitespace-pre-wrap pr-3">{message}</span>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className="border-b py-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-sm font-semibold">Target Conversation</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                The public trace used by the Driver and recorded evaluators.
              </p>
            </div>
            {target ? <ModelIdentityLabel modelId={target.targetModel} /> : null}
          </div>
          {target?.turns.length ? (
            <div className="mt-4 space-y-4">
              {target.turns.map((turn) => (
                <article className="border-y" key={turn.id}>
                  <ScenarioText label={`User · turn ${turn.position + 1}`} value={turn.input} />
                  <ScenarioText
                    label={turn.status === "completed" ? "Assistant" : `Assistant · ${turn.status}`}
                    value={turn.output ?? turn.errorMessage ?? "Waiting for a response."}
                  />
                </article>
              ))}
            </div>
          ) : (
            <p className="mt-4 text-sm text-muted-foreground">
              The first Target turn has not completed yet.
            </p>
          )}
        </section>

        <section className="py-6">
          <h2 className="text-sm font-semibold">Recorded Evaluations</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Each selected Criteria configuration evaluates the final completed Target response.
          </p>
          {scenario.evaluationErrorMessage ? (
            <p className="mt-4 text-sm text-destructive">{scenario.evaluationErrorMessage}</p>
          ) : null}
          {evaluations.length ? (
            <div className="mt-4 divide-y border-y">
              {evaluations.map(({ configurationName, id, judgeModels, status }) => (
                <Link
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-3 py-3 hover:bg-muted/35"
                  href={`/evaluations/${id}`}
                  key={id}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{configurationName}</span>
                    <span className="mt-0.5 block text-[11px] text-muted-foreground">
                      {status} · {judgeModels.length} judge{" "}
                      {judgeModels.length === 1 ? "model" : "models"}
                    </span>
                  </span>
                  <ChevronRight className="size-4 text-muted-foreground" />
                </Link>
              ))}
            </div>
          ) : (
            <p className="mt-4 text-sm text-muted-foreground">
              {runActive
                ? "Evaluations start after the final Target response."
                : "No evaluation runs were created."}
            </p>
          )}
        </section>
      </div>
    </div>
  );
}

function ScenarioFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 px-3 py-3">
      <p className="font-mono text-[10px] uppercase text-muted-foreground">{label}</p>
      <p className="mt-1 truncate font-medium">{value}</p>
    </div>
  );
}

function ScenarioText({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 px-3 py-4">
      <p className="font-mono text-[10px] uppercase text-muted-foreground">{label}</p>
      <p className="mt-2 whitespace-pre-wrap text-sm leading-6">{value}</p>
    </div>
  );
}

function scenarioStatus(response: ScenarioRunResponse): string {
  if (isScenarioEvaluationActive(response)) return "Evaluating final response";
  if (isScenarioActive(response)) {
    return response.scenario.status === "queued" ? "Queued" : "Generating conversation";
  }
  const { scenario } = response;
  if (scenario.status === "completed") return "Completed";
  return scenario.status.charAt(0).toUpperCase() + scenario.status.slice(1);
}
