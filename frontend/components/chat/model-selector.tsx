/** Presents the configured model catalog as a compact provider-icon picker without inventing unsupported catalog metadata. */

"use client";

import { Check, ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/components/ui/utils";
import type { ConfiguredModel } from "@/contracts/chat";
import { useDismissibleDetails } from "@/hooks/use-dismissible-details";

const PROVIDER_COLORS: Partial<Record<string, string>> = {
  deepseek: "#5c75ef",
  openai: "currentColor",
};

const modelIdentityRequests = new Map<string, Promise<ConfiguredModel>>();

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
        <span className="truncate">{selected?.label ?? "Select model"}</span>
        <ChevronDown
          aria-hidden="true"
          className="size-3 shrink-0 text-muted-foreground transition-transform group-open/model:rotate-180"
        />
      </summary>
      <div className="absolute bottom-[calc(100%+8px)] left-0 z-50 w-max max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-xl border bg-popover p-1 text-popover-foreground shadow-xl">
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
      </div>
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
  const src = provider ? `https://models.dev/logos/${encodeURIComponent(provider)}.svg` : undefined;
  const [failedSrc, setFailedSrc] = useState<string>();

  if (!identity)
    return <span aria-hidden="true" className="size-4 shrink-0 rounded-full bg-muted" />;
  if (provider === "google") return <GoogleLogo className={className} />;
  const color = provider ? PROVIDER_COLORS[provider] : undefined;
  if (src && color) {
    const maskImage = `url("${src.replaceAll('"', "%22")}")`;
    return (
      <span
        aria-label={`${provider} logo`}
        className={cn("inline-block size-4 shrink-0", className)}
        role="img"
        style={{
          backgroundColor: color,
          maskImage,
          maskPosition: "center",
          maskRepeat: "no-repeat",
          maskSize: "contain",
          WebkitMaskImage: maskImage,
          WebkitMaskPosition: "center",
          WebkitMaskRepeat: "no-repeat",
          WebkitMaskSize: "contain",
        }}
      />
    );
  }
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
      alt={`${provider} logo`}
      className={cn("size-4 shrink-0 object-contain dark:invert", className)}
      height={16}
      onError={() => setFailedSrc(src)}
      src={src}
      width={16}
    />
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
    request = fetch(`/api/model-identity?modelId=${encodeURIComponent(modelId)}`, {
      cache: "no-store",
    }).then(async (response) => {
      if (!response.ok) throw new Error(`Model identity request failed with ${response.status}.`);
      return (await response.json()) as ConfiguredModel;
    });
    modelIdentityRequests.set(modelId, request);
    void request.catch(() => modelIdentityRequests.delete(modelId));
  }
  return request;
}

function GoogleLogo({ className }: { className?: string }) {
  return (
    <svg
      aria-label="Google logo"
      className={cn("size-4 shrink-0", className)}
      role="img"
      viewBox="0 0 16 16"
    >
      <path
        d="M8.15991 6.54543V9.64362H12.4654C12.2763 10.64 11.709 11.4837 10.8581 12.0509L13.4544 14.0655C14.9671 12.6692 15.8399 10.6182 15.8399 8.18188C15.8399 7.61461 15.789 7.06911 15.6944 6.54552L8.15991 6.54543Z"
        fill="#4285F4"
      />
      <path
        d="M3.6764 9.52268L3.09083 9.97093L1.01807 11.5855C2.33443 14.1963 5.03241 16 8.15966 16C10.3196 16 12.1305 15.2873 13.4542 14.0655L10.8578 12.0509C10.1451 12.5309 9.23598 12.8219 8.15966 12.8219C6.07967 12.8219 4.31245 11.4182 3.67967 9.5273L3.6764 9.52268Z"
        fill="#34A853"
      />
      <path
        d="M1.01803 4.41455C0.472607 5.49087 0.159912 6.70543 0.159912 7.99995C0.159912 9.29447 0.472607 10.509 1.01803 11.5854C1.01803 11.5926 3.6799 9.51991 3.6799 9.51991C3.5199 9.03991 3.42532 8.53085 3.42532 7.99987C3.42532 7.46889 3.5199 6.95983 3.6799 6.47983L1.01803 4.41455Z"
        fill="#FBBC05"
      />
      <path
        d="M8.15982 3.18545C9.33802 3.18545 10.3853 3.59271 11.2216 4.37818L13.5125 2.0873C12.1234 0.792777 10.3199 0 8.15982 0C5.03257 0 2.33443 1.79636 1.01807 4.41455L3.67985 6.48001C4.31254 4.58908 6.07983 3.18545 8.15982 3.18545Z"
        fill="#EA4335"
      />
    </svg>
  );
}
