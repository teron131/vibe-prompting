/** Presents the configured model catalog as a compact provider-icon picker without inventing unsupported catalog metadata. */

"use client";

import { Check, ChevronDown } from "lucide-react";
import { useRef } from "react";

import { cn } from "@/components/ui/utils";
import type { ConfiguredModel } from "@/contracts/chat";
import { useDismissibleDetails } from "@/hooks/use-dismissible-details";

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
      <div className="absolute bottom-[calc(100%+8px)] left-0 z-50 min-w-64 overflow-hidden rounded-xl border bg-popover p-1.5 text-popover-foreground shadow-xl">
        <div className="px-2.5 py-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          Configured models
        </div>
        {models.map((model) => (
          <button
            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-accent"
            key={model.id}
            onClick={() => {
              onChange(model.id);
              if (detailsRef.current) detailsRef.current.open = false;
            }}
            type="button"
          >
            <ModelIcon model={model} />
            <span className="min-w-0 flex-1 truncate">{model.label}</span>
            {model.id === value ? <Check aria-label="Selected" className="size-4" /> : null}
          </button>
        ))}
      </div>
    </details>
  );
}

const PROVIDER_COLORS: Record<string, string> = {
  anthropic: "currentColor",
  deepseek: "#5c75ef",
  meta: "#1781e4",
  mistral: "#e89319",
  openai: "currentColor",
  xai: "currentColor",
};

export function ModelIcon({ className, model }: { className?: string; model?: ConfiguredModel }) {
  if (!model) return <span aria-hidden="true" className="size-4 shrink-0 rounded-full bg-muted" />;
  if (model.provider === "google") {
    return (
      <img
        alt="Google logo"
        className={cn("size-4 shrink-0 object-contain", className)}
        height={16}
        src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg"
        width={16}
      />
    );
  }
  const src = `https://models.dev/logos/${encodeURIComponent(model.provider)}.svg`;
  const color = PROVIDER_COLORS[model.provider];
  if (color) {
    const maskImage = `url("${src}")`;
    return (
      <span
        aria-label={`${model.provider} logo`}
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
  return (
    <img
      alt={`${model.provider} logo`}
      className={cn("size-4 shrink-0 object-contain dark:invert", className)}
      height={16}
      src={src}
      width={16}
    />
  );
}
