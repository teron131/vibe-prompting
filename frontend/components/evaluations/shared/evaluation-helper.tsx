/** Places bounded natural-language queries beside the evaluation data controls they refine. */

"use client";

import { ArrowUpRight, LoaderCircle, Sparkles } from "lucide-react";
import { SyntheticEvent, useState } from "react";

import { ModelIdentityLabel } from "@/components/chat/model-selector";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/components/ui/utils";
import type { EvaluationQueryResponse } from "@/contracts/evaluation-workspace";
import { requestJson } from "@/shared/api";

type EvaluationHelperResponse = EvaluationQueryResponse & { modelId: string };

export function EvaluationHelper({ className }: { className?: string }) {
  const [question, setQuestion] = useState("");
  const [result, setResult] = useState<EvaluationHelperResponse>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();

  async function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const instruction = question.trim();
    if (!instruction) return;
    setLoading(true);
    setError(undefined);
    try {
      setResult(
        await requestJson<EvaluationHelperResponse>("/api/evaluations/explorer", {
          body: JSON.stringify({ question: instruction }),
          headers: { "content-type": "application/json" },
          method: "POST",
        }),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The data question failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section aria-label="Evaluation data helper" className={cn("min-w-0", className)}>
      <form className="grid grid-cols-[minmax(0,1fr)_auto] gap-2" onSubmit={submit}>
        <div className="relative min-w-0">
          <Sparkles
            aria-hidden="true"
            className="absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            aria-label="Ask the evaluation data helper"
            className="h-9 pl-9 text-xs shadow-none sm:h-8"
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="Ask for a count, comparison, grouping, or average"
            value={question}
          />
        </div>
        <Button
          className="h-9 sm:h-8"
          disabled={loading || !question.trim()}
          size="sm"
          type="submit"
        >
          {loading ? (
            <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" />
          ) : (
            <Sparkles aria-hidden="true" className="size-3.5" />
          )}
          Ask
        </Button>
      </form>
      {error ? (
        <p className="mt-2 text-xs text-destructive">{error}</p>
      ) : result ? (
        <div className="mt-2 flex flex-col gap-2 border-y py-2 text-xs sm:flex-row sm:items-center">
          <p className="min-w-0 flex-1">{result.answer}</p>
          <ModelIdentityLabel
            className="shrink-0 text-muted-foreground"
            labelClassName="font-mono text-[11px]"
            modelId={result.modelId}
            variant="short-id"
          />
          <a
            className="inline-flex shrink-0 items-center gap-1 font-medium hover:underline"
            href={result.href}
          >
            Open view
            <ArrowUpRight aria-hidden="true" className="size-3.5" />
          </a>
        </div>
      ) : null}
    </section>
  );
}
