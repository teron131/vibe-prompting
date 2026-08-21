/** Presents the configured model catalog as a compact provider-icon picker without inventing unsupported catalog metadata. */

"use client";

import { Check, ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/components/ui/utils";
import type { ConfiguredModel } from "@/contracts/chat";
import { useDismissibleDetails } from "@/hooks/use-dismissible-details";
import { requestJson } from "@/shared/api";

import { ComposerMenu } from "./composer-menu";

const modelIdentityRequests = new Map<string, Promise<ConfiguredModel>>();
const ARTIFICIAL_ANALYSIS_LOGO_BASE_URL = "https://artificialanalysis.ai/img/logos";

export function ModelSelector({
  disabled,
  models,
  onChange,
  value,
}: {
  disabled: boolean;
  models: ConfiguredModel[];
  onChange(value: string): void;
  value: string;
}) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const selected = models.find((model) => model.id === value);
  useDismissibleDetails(detailsRef);

  return (
    <details className="group/model relative" ref={detailsRef}>
      <summary
        aria-label="Select model"
        className={cn(
          "flex h-8 max-w-56 cursor-pointer list-none items-center gap-2 rounded-full px-2.5 text-xs font-medium transition-colors hover:bg-accent [&::-webkit-details-marker]:hidden",
          disabled && "pointer-events-none opacity-50",
        )}
      >
        <ModelIcon model={selected} />
        <span className="hidden truncate sm:inline">{selected?.label ?? "Select model"}</span>
        <ChevronDown
          aria-hidden="true"
          className="size-3 shrink-0 text-muted-foreground transition-transform group-open/model:rotate-180"
        />
      </summary>
      <ComposerMenu className="overflow-hidden p-1">
        <div className="px-2 py-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          Configured models
        </div>
        {models.map((model) => (
          <button
            className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-accent"
            key={model.id}
            onClick={() => {
              onChange(model.id);
              if (detailsRef.current) detailsRef.current.open = false;
            }}
            type="button"
          >
            <ModelIcon model={model} />
            <span className="min-w-0 truncate">{model.label}</span>
            <span className="ml-auto grid size-4 place-items-center">
              {model.id === value ? <Check aria-label="Selected" className="size-3.5" /> : null}
            </span>
          </button>
        ))}
      </ComposerMenu>
    </details>
  );
}

export function ModelIcon({
  className,
  model,
  modelId,
}: {
  className?: string;
  model?: ConfiguredModel;
  modelId?: string;
}) {
  const identity = useModelIdentity(model, modelId);
  const provider = identity?.provider.trim().toLowerCase();
  const src = provider
    ? `${ARTIFICIAL_ANALYSIS_LOGO_BASE_URL}/${encodeURIComponent(provider)}_small.svg`
    : undefined;
  const [failedSrc, setFailedSrc] = useState<string>();

  if (!identity)
    return <span aria-hidden="true" className="size-4 shrink-0 rounded-full bg-muted" />;
  if (!src || failedSrc === src) {
    return (
      <span
        aria-label={`${identity.provider} logo unavailable`}
        className={cn(
          "inline-flex size-4 shrink-0 items-center justify-center rounded-sm bg-foreground/10 font-mono text-[9px] font-semibold uppercase",
          className,
        )}
        role="img"
      >
        {identity.provider.slice(0, 1)}
      </span>
    );
  }
  return (
    <img
      alt={`${identity.provider} logo`}
      className={cn("size-4 shrink-0 object-contain", className)}
      height={16}
      onError={() => setFailedSrc(src)}
      src={src}
      width={16}
    />
  );
}

export function ModelIdentityLabel({
  className,
  labelClassName,
  model,
  modelId,
  variant = "label",
}: {
  className?: string;
  labelClassName?: string;
  model?: ConfiguredModel;
  modelId?: string;
  variant?: "full-id" | "label" | "short-id";
}) {
  const identity = useModelIdentity(model, modelId);
  const id = identity?.id ?? modelId ?? model?.id;
  const label =
    variant === "full-id"
      ? id
      : variant === "short-id"
        ? shortModelLabel(id)
        : (identity?.label ?? shortModelLabel(id));

  if (!id) return null;
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1.5", className)} title={id}>
      <span aria-hidden="true" className="inline-flex shrink-0">
        <ModelIcon model={identity} modelId={modelId} />
      </span>
      <span className={cn("min-w-0 truncate", labelClassName)}>{label}</span>
    </span>
  );
}

export function useModelIdentity(
  model?: ConfiguredModel,
  modelId?: string,
): ConfiguredModel | undefined {
  const [resolvedModel, setResolvedModel] = useState<ConfiguredModel>();

  useEffect(() => {
    if (model || !modelId) return;
    let active = true;
    void loadModelIdentity(modelId)
      .then((resolved) => {
        if (active) setResolvedModel(resolved);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [model, modelId]);

  return model ?? (resolvedModel?.id === modelId ? resolvedModel : undefined);
}

async function loadModelIdentity(modelId: string): Promise<ConfiguredModel> {
  let request = modelIdentityRequests.get(modelId);
  if (!request) {
    request = requestJson<ConfiguredModel>(
      `/api/model-identity?modelId=${encodeURIComponent(modelId)}`,
      { cache: "no-store" },
      (status) => `Model identity request failed with ${status}.`,
    );
    modelIdentityRequests.set(modelId, request);
    void request.catch(() => modelIdentityRequests.delete(modelId));
  }
  return request;
}

function shortModelLabel(modelId?: string): string {
  if (!modelId) return "Unknown model";
  return modelId.split("/").at(-1) ?? modelId;
}
