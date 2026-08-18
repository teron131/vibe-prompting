/** Owns the chat draft, attachments, configured model choice, reasoning effort, tools, and send or stop controls. */

"use client";

import {
  ArrowUp,
  Brain,
  Check,
  ChevronDown,
  FileText,
  Paperclip,
  Square,
  Wrench,
  X,
} from "lucide-react";
import { useEffect, useRef } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/utils";
import type {
  Attachment,
  ChatReasoningEffort,
  ChatToolId,
  ConfiguredModel,
} from "@/contracts/chat";
import { useDismissibleDetails } from "@/hooks/use-dismissible-details";

import { ModelSelector } from "./model-selector";

const TOOL_OPTIONS: Array<{ description: string; id: ChatToolId; label: string }> = [
  {
    description: "Create, read, and edit saved prompt artifacts.",
    id: "prompt-library",
    label: "Prompt library",
  },
  {
    description: "Start persisted prompt evaluations and score reports.",
    id: "evaluations",
    label: "Evaluations",
  },
  {
    description: "Search the web when current information is needed.",
    id: "web-search",
    label: "Web search",
  },
];

const REASONING_OPTIONS: Array<{ label: string; value: ChatReasoningEffort }> = [
  { label: "Low", value: "low" },
  { label: "Medium", value: "medium" },
  { label: "High", value: "high" },
  { label: "Extra high", value: "xhigh" },
];

export function ChatComposer({
  attachments,
  enabledTools,
  instruction,
  models,
  onAttachmentsChange,
  onInstructionChange,
  onModelChange,
  onReasoningEffortChange,
  onStop,
  onSubmit,
  onToolsChange,
  reasoningEffort,
  running,
  selectedModelId,
}: {
  attachments: Attachment[];
  enabledTools: ChatToolId[];
  instruction: string;
  models: ConfiguredModel[];
  onAttachmentsChange(value: Attachment[]): void;
  onInstructionChange(value: string): void;
  onModelChange(value: string): void;
  onReasoningEffortChange(value: ChatReasoningEffort): void;
  onStop(): void;
  onSubmit(): void;
  onToolsChange(value: ChatToolId[]): void;
  reasoningEffort: ChatReasoningEffort;
  running: boolean;
  selectedModelId: string;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const canSubmit = Boolean((instruction.trim() || attachments.length) && selectedModelId);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "44px";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
  }, [instruction]);

  return (
    <div className="mx-auto w-full max-w-3xl px-3 pb-4 sm:px-6 sm:pb-6">
      <form
        className="rounded-3xl border border-border/70 bg-background p-3 shadow-lg transition-shadow focus-within:shadow-xl"
        onSubmit={(event) => {
          event.preventDefault();
          if (canSubmit && !running) onSubmit();
        }}
      >
        <input
          className="hidden"
          multiple
          onChange={(event) => {
            void addFiles(Array.from(event.target.files ?? []), attachments, onAttachmentsChange);
            event.target.value = "";
          }}
          ref={fileInputRef}
          type="file"
        />
        {attachments.length ? (
          <AttachmentPreviews attachments={attachments} onChange={onAttachmentsChange} />
        ) : null}
        <textarea
          aria-label="Message"
          className="block min-h-11 w-full resize-none overflow-y-auto bg-transparent px-2 py-2 text-base leading-7 outline-none placeholder:text-muted-foreground"
          disabled={running}
          onChange={(event) => onInstructionChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              if (canSubmit && !running) onSubmit();
            }
          }}
          onPaste={(event) => {
            const files = Array.from(event.clipboardData.files).filter((file) =>
              file.type.startsWith("image/"),
            );
            if (files.length) {
              event.preventDefault();
              void addFiles(files, attachments, onAttachmentsChange);
            }
          }}
          placeholder="Send a message..."
          ref={textareaRef}
          rows={1}
          value={instruction}
        />
        <div className="mt-1 flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1">
            <button
              aria-label="Attach files"
              className="grid size-8 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
              disabled={running}
              onClick={() => fileInputRef.current?.click()}
              type="button"
            >
              <Paperclip aria-hidden="true" className="size-4" />
            </button>
            <ToolSelector disabled={running} onChange={onToolsChange} value={enabledTools} />
            <ModelSelector
              disabled={running}
              models={models}
              onChange={onModelChange}
              value={selectedModelId}
            />
            <ReasoningSelector
              disabled={running}
              onChange={onReasoningEffortChange}
              value={reasoningEffort}
            />
          </div>
          {running ? (
            <Button
              aria-label="Stop generating"
              className="size-10 shrink-0 rounded-full"
              onClick={onStop}
              size="icon"
            >
              <Square aria-hidden="true" className="size-3.5 fill-current" />
            </Button>
          ) : (
            <Button
              aria-label="Send message"
              className="size-10 shrink-0 rounded-full"
              disabled={!canSubmit}
              size="icon"
              type="submit"
            >
              <ArrowUp aria-hidden="true" className="size-4" />
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}

function AttachmentPreviews({
  attachments,
  onChange,
}: {
  attachments: Attachment[];
  onChange(value: Attachment[]): void;
}) {
  return (
    <div className="mb-2 flex gap-2 overflow-x-auto px-1">
      {attachments.map((attachment) => (
        <div
          className="relative flex h-16 min-w-40 max-w-56 items-center gap-2 rounded-xl border bg-muted/50 p-2"
          key={`${attachment.name}-${attachment.size}`}
        >
          {attachment.mediaType.startsWith("image/") ? (
            <img alt="" className="size-11 rounded-lg object-cover" src={attachment.dataUrl} />
          ) : (
            <span className="grid size-11 place-items-center rounded-lg bg-background">
              <FileText aria-hidden="true" className="size-5 text-muted-foreground" />
            </span>
          )}
          <div className="min-w-0">
            <div className="truncate text-xs font-medium">{attachment.name}</div>
            <div className="mt-1 text-[10px] text-muted-foreground">
              {formatBytes(attachment.size)}
            </div>
          </div>
          <button
            aria-label={`Remove ${attachment.name}`}
            className="absolute -right-1 -top-1 grid size-5 place-items-center rounded-full border bg-background shadow-sm"
            onClick={() => onChange(attachments.filter((candidate) => candidate !== attachment))}
            type="button"
          >
            <X aria-hidden="true" className="size-3" />
          </button>
        </div>
      ))}
    </div>
  );
}

function ReasoningSelector({
  disabled,
  onChange,
  value,
}: {
  disabled: boolean;
  onChange(value: ChatReasoningEffort): void;
  value: ChatReasoningEffort;
}) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  useDismissibleDetails(detailsRef);
  return (
    <details className="group/effort relative" ref={detailsRef}>
      <summary
        aria-label={`Reasoning effort: ${REASONING_OPTIONS.find((option) => option.value === value)?.label}`}
        className={cn(
          "flex h-8 cursor-pointer list-none items-center gap-2 rounded-full px-2.5 text-xs font-medium hover:bg-accent [&::-webkit-details-marker]:hidden",
          disabled && "pointer-events-none opacity-50",
        )}
      >
        <Brain aria-hidden="true" className="size-4 text-muted-foreground" />
        <span className="hidden sm:inline">
          {REASONING_OPTIONS.find((option) => option.value === value)?.label}
        </span>
        <ChevronDown
          aria-hidden="true"
          className="size-3 shrink-0 text-muted-foreground transition-transform group-open/effort:rotate-180"
        />
      </summary>
      <div className="absolute bottom-[calc(100%+8px)] left-0 z-50 w-max rounded-xl border bg-popover p-1 shadow-xl">
        {REASONING_OPTIONS.map((option) => (
          <button
            className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-accent"
            key={option.value}
            onClick={() => {
              onChange(option.value);
              if (detailsRef.current) detailsRef.current.open = false;
            }}
            type="button"
          >
            <span className="whitespace-nowrap text-left">{option.label}</span>
            <span className="ml-auto grid size-4 place-items-center">
              {option.value === value ? <Check aria-label="Selected" className="size-3.5" /> : null}
            </span>
          </button>
        ))}
      </div>
    </details>
  );
}

function ToolSelector({
  disabled,
  onChange,
  value,
}: {
  disabled: boolean;
  onChange(value: ChatToolId[]): void;
  value: ChatToolId[];
}) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const selected = new Set(value);
  useDismissibleDetails(detailsRef);
  return (
    <details className="group/tools relative" ref={detailsRef}>
      <summary
        aria-label="Tools"
        className={cn(
          "flex size-8 cursor-pointer list-none items-center justify-center rounded-full transition-colors hover:bg-accent [&::-webkit-details-marker]:hidden",
          value.length > 0 && "bg-primary text-primary-foreground hover:bg-primary/90",
          disabled && "pointer-events-none opacity-50",
        )}
      >
        <Wrench aria-hidden="true" className="size-3.5" />
      </summary>
      <div className="absolute bottom-[calc(100%+8px)] left-0 z-50 w-72 rounded-xl border bg-popover p-1.5 text-popover-foreground shadow-xl">
        <div className="px-2.5 py-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          Tools
        </div>
        {TOOL_OPTIONS.map((tool) => {
          const active = selected.has(tool.id);
          return (
            <button
              className="flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-accent"
              key={tool.id}
              onClick={() =>
                onChange(active ? value.filter((id) => id !== tool.id) : [...value, tool.id])
              }
              type="button"
            >
              <span className="mt-0.5 grid size-4 shrink-0 place-items-center rounded border">
                {active ? <Check aria-hidden="true" className="size-3" /> : null}
              </span>
              <span>
                <span className="block text-sm font-medium">{tool.label}</span>
                <span className="mt-0.5 block text-xs leading-4 text-muted-foreground">
                  {tool.description}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </details>
  );
}

async function addFiles(
  files: File[],
  current: Attachment[],
  onChange: (value: Attachment[]) => void,
): Promise<void> {
  const available = Math.max(0, 4 - current.length);
  if (files.length > available) toast.error("A message can include at most four attachments.");
  const accepted = files.slice(0, available).filter((file) => {
    if (file.size <= 8 * 1024 * 1024) return true;
    toast.error(`${file.name} is larger than 8 MB.`);
    return false;
  });
  const attachments = await Promise.all(
    accepted.map(async (file) => ({
      dataUrl: await readDataUrl(file),
      mediaType: file.type || "application/octet-stream",
      name: file.name,
      size: file.size,
    })),
  );
  onChange([...current, ...attachments]);
}

function readDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("The file could not be read."));
    reader.onload = () =>
      typeof reader.result === "string"
        ? resolve(reader.result)
        : reject(new Error("The file could not be read."));
    reader.readAsDataURL(file);
  });
}

function formatBytes(size: number): string {
  return size < 1024 * 1024
    ? `${Math.max(1, Math.round(size / 1024))} KB`
    : `${(size / 1024 / 1024).toFixed(1)} MB`;
}
