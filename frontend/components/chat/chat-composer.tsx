/** Owns the chat draft, attachments, configured model choice, reasoning effort, tools, and send or stop controls. */

"use client";

import {
  ArrowUp,
  AtSign,
  Brain,
  Check,
  ChevronDown,
  FileText,
  FlaskConical,
  PanelRightOpen,
  Paperclip,
  Square,
  Wrench,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { usePromptSearch } from "@/components/prompts/use-search";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/utils";
import type {
  Attachment,
  ChatQuote,
  ChatReasoningEffort,
  ChatToolId,
  ConfiguredModel,
  TargetRunQuote,
} from "@/contracts/chat";
import type { PromptSummary } from "@/contracts/prompts";
import { useDismissibleDetails } from "@/hooks/use-dismissible-details";

import { ComposerMenu } from "./composer-menu";
import { ModelSelector } from "./model-selector";

const TOOL_OPTIONS: Array<{ description: string; id: ChatToolId; label: string }> = [
  {
    description: "Create, read, and edit saved prompts.",
    id: "prompt-library",
    label: "Prompt Library",
  },
  {
    description: "Start persisted prompt evaluations and score reports.",
    id: "evaluations",
    label: "Evaluations",
  },
  {
    description: "Search the web when current information is needed.",
    id: "web-search",
    label: "Web Search",
  },
];

const REASONING_OPTIONS: Array<{ label: string; value: ChatReasoningEffort }> = [
  { label: "Low", value: "low" },
  { label: "Medium", value: "medium" },
  { label: "High", value: "high" },
  { label: "Extra High", value: "xhigh" },
];

export function ChatComposer({
  activePrompt,
  attachments,
  enabledTools,
  instruction,
  models,
  onAttachmentsChange,
  onInstructionChange,
  onModelChange,
  onOpenPrompt,
  onPromptChange,
  onQuoteRemove,
  onReasoningEffortChange,
  onStop,
  onSubmit,
  onToolsChange,
  prompts,
  quotes,
  reasoningEffort,
  running,
  selectedModelId,
  targetModelLocked = false,
  variant = "agent",
}: {
  activePrompt?: PromptSummary;
  attachments: Attachment[];
  enabledTools: ChatToolId[];
  instruction: string;
  models: ConfiguredModel[];
  onAttachmentsChange(value: Attachment[]): void;
  onInstructionChange(value: string): void;
  onModelChange(value: string): void;
  onOpenPrompt(): void;
  onPromptChange(prompt: PromptSummary | undefined): void;
  onQuoteRemove(quote: ChatQuote): void;
  onReasoningEffortChange(value: ChatReasoningEffort): void;
  onStop(): void;
  onSubmit(): void;
  onToolsChange(value: ChatToolId[]): void;
  prompts: PromptSummary[];
  quotes: ChatQuote[];
  reasoningEffort: ChatReasoningEffort;
  running: boolean;
  selectedModelId: string;
  targetModelLocked?: boolean;
  variant?: "agent" | "target";
}) {
  const composerRef = useRef<HTMLFormElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [activeMentionIndex, setActiveMentionIndex] = useState(0);
  const [mentionOpen, setMentionOpen] = useState(false);
  const mentionQuery =
    variant === "agent" ? (instruction.match(/(?:^|\s)@([^@\n]*)$/)?.[1] ?? null) : null;
  const canSubmit = Boolean(
    (instruction.trim() || (variant === "agent" && (attachments.length || quotes.length))) &&
    selectedModelId,
  );
  const canSteer = Boolean(instruction.trim());

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "44px";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
  }, [instruction]);

  useEffect(() => {
    if (mentionQuery !== null) {
      setMentionOpen(true);
      return;
    }
    setMentionOpen(false);
  }, [mentionQuery]);

  const {
    error: mentionSearchError,
    loading: mentionSearchLoading,
    results: matchingPrompts,
  } = usePromptSearch({
    enabled: variant === "agent" && mentionOpen,
    limit: 6,
    prompts,
    query: mentionQuery,
  });
  const activeMentionPrompt = matchingPrompts[activeMentionIndex] ?? matchingPrompts[0];
  const effectiveMentionIndex = matchingPrompts[activeMentionIndex] ? activeMentionIndex : 0;

  useEffect(() => {
    setActiveMentionIndex(0);
  }, [mentionOpen, mentionQuery]);

  useEffect(() => {
    if (!mentionOpen || !activeMentionPrompt) return;
    document
      .getElementById(`prompt-mention-option-${activeMentionPrompt.id}`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeMentionPrompt, mentionOpen]);

  useEffect(() => {
    if (!mentionOpen) return;
    function dismissOnOutsideClick(event: PointerEvent) {
      if (!composerRef.current?.contains(event.target as Node)) {
        setMentionOpen(false);
      }
    }
    document.addEventListener("pointerdown", dismissOnOutsideClick);
    return () => document.removeEventListener("pointerdown", dismissOnOutsideClick);
  }, [mentionOpen]);

  function closeMention() {
    setMentionOpen(false);
  }

  function selectPrompt(prompt: PromptSummary) {
    if (mentionQuery !== null) {
      onInstructionChange(
        instruction.replace(/(?:^|\s)@([^@\n]*)$/, (match) => (match.startsWith(" ") ? " " : "")),
      );
    }
    onPromptChange(prompt);
    setMentionOpen(false);
    window.requestAnimationFrame(() => textareaRef.current?.focus());
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-3 pb-4 sm:px-6 sm:pb-6">
      <form
        className="@container relative rounded-3xl border border-border/70 bg-background p-3 shadow-lg transition-shadow focus-within:shadow-xl"
        onSubmit={(event) => {
          event.preventDefault();
          if (running ? variant === "agent" && canSteer : canSubmit) onSubmit();
        }}
        ref={composerRef}
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
        {variant === "agent" && attachments.length ? (
          <AttachmentPreviews attachments={attachments} onChange={onAttachmentsChange} />
        ) : null}
        {variant === "agent" && (activePrompt || quotes.length) ? (
          <div className="mb-2 flex flex-wrap gap-1.5 px-1">
            {activePrompt ? (
              <span className="inline-flex max-w-full items-center rounded-full bg-secondary text-xs font-medium">
                <button
                  aria-label={`Open prompt editor for ${activePrompt.title}`}
                  className="inline-flex min-w-0 items-center gap-1.5 rounded-l-full py-1 pl-2.5 pr-1.5 hover:bg-secondary/80"
                  onClick={onOpenPrompt}
                  type="button"
                >
                  <FileText aria-hidden="true" className="size-3.5 shrink-0" />
                  <span className="truncate">{activePrompt.title}</span>
                  <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                    {activePrompt.revisionId.slice(0, 8)}
                  </span>
                  <PanelRightOpen
                    aria-hidden="true"
                    className="size-3.5 shrink-0 text-muted-foreground"
                  />
                </button>
                {variant === "agent" ? (
                  <button
                    aria-label={`Detach ${activePrompt.title} from this chat`}
                    className="mr-0.5 grid size-6 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-background/70 hover:text-foreground"
                    onClick={() => onPromptChange(undefined)}
                    type="button"
                  >
                    <X aria-hidden="true" className="size-3" />
                  </button>
                ) : null}
              </span>
            ) : null}
            {variant === "agent"
              ? quotes.map((quote) =>
                  isTargetRunQuote(quote) ? (
                    <span
                      className="inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs"
                      key={quote.runId}
                    >
                      <FlaskConical aria-hidden="true" className="size-3.5 shrink-0" />
                      <span>Target Run</span>
                      <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                        {quote.runId.slice(0, 8)}
                      </span>
                      <button
                        aria-label={`Remove Target Run ${quote.runId}`}
                        className="grid size-4 shrink-0 place-items-center rounded-full hover:bg-accent"
                        onClick={() => onQuoteRemove(quote)}
                        type="button"
                      >
                        <X aria-hidden="true" className="size-3" />
                      </button>
                    </span>
                  ) : (
                    <span
                      className="inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs"
                      key={`${quote.promptId}-${quote.revisionId}-${quote.text}`}
                    >
                      <span className="truncate">Quoted from {quote.title}</span>
                      <button
                        aria-label={`Remove quote from ${quote.title}`}
                        className="grid size-4 shrink-0 place-items-center rounded-full hover:bg-accent"
                        onClick={() => onQuoteRemove(quote)}
                        type="button"
                      >
                        <X aria-hidden="true" className="size-3" />
                      </button>
                    </span>
                  ),
                )
              : null}
          </div>
        ) : null}
        <textarea
          aria-activedescendant={
            mentionOpen && activeMentionPrompt
              ? `prompt-mention-option-${activeMentionPrompt.id}`
              : undefined
          }
          aria-autocomplete="list"
          aria-controls={mentionOpen ? "prompt-mention-listbox" : undefined}
          aria-expanded={mentionOpen}
          aria-haspopup="listbox"
          aria-label={variant === "target" ? "Target Test message" : "Message"}
          className="block min-h-11 w-full resize-none overflow-y-auto bg-transparent px-2 py-2 text-base leading-7 outline-none placeholder:text-muted-foreground"
          disabled={variant === "target" && running}
          onChange={(event) => {
            onInstructionChange(event.target.value);
            if (mentionOpen && mentionQuery === null) setMentionOpen(false);
          }}
          onKeyDown={(event) => {
            if (mentionOpen && event.key === "ArrowDown") {
              event.preventDefault();
              setActiveMentionIndex((index) =>
                matchingPrompts.length ? (index + 1) % matchingPrompts.length : 0,
              );
              return;
            }
            if (mentionOpen && event.key === "ArrowUp") {
              event.preventDefault();
              setActiveMentionIndex((index) =>
                matchingPrompts.length
                  ? (index - 1 + matchingPrompts.length) % matchingPrompts.length
                  : 0,
              );
              return;
            }
            if (mentionOpen && event.key === "Escape") {
              event.preventDefault();
              closeMention();
              return;
            }
            if (event.key === "Enter" && !event.shiftKey) {
              if (event.nativeEvent.isComposing) return;
              event.preventDefault();
              if (mentionOpen) {
                if (activeMentionPrompt) selectPrompt(activeMentionPrompt);
                return;
              }
              if (running ? canSteer : canSubmit) composerRef.current?.requestSubmit();
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
          placeholder={
            running
              ? variant === "target"
                ? "Wait for this Target turn to finish…"
                : "Add guidance while the agent works…"
              : variant === "target"
                ? "Test this target…"
                : "Ask anything, or use @ to reference a prompt…"
          }
          ref={textareaRef}
          role="combobox"
          rows={1}
          value={instruction}
        />
        <div className="mt-1 flex min-w-0 items-center gap-2">
          <div className="min-w-0 flex-1 overflow-x-auto overscroll-x-contain [scrollbar-width:none] sm:overflow-visible [&::-webkit-scrollbar]:hidden">
            <div className="flex w-max items-center gap-1 pr-1 [&>details]:shrink-0">
              {variant === "agent" ? (
                <button
                  aria-label="Attach files"
                  className="grid size-8 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
                  disabled={running}
                  onClick={() => fileInputRef.current?.click()}
                  type="button"
                >
                  <Paperclip aria-hidden="true" className="size-4" />
                </button>
              ) : null}
              {variant === "agent" ? (
                <button
                  aria-controls={mentionOpen ? "prompt-mention-listbox" : undefined}
                  aria-expanded={mentionOpen}
                  aria-label="Search prompts"
                  className={cn(
                    "grid size-8 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground",
                    mentionOpen && "bg-accent text-foreground",
                  )}
                  disabled={running}
                  onClick={() => {
                    if (mentionOpen) closeMention();
                    else setMentionOpen(true);
                    window.requestAnimationFrame(() => textareaRef.current?.focus());
                  }}
                  type="button"
                >
                  <AtSign aria-hidden="true" className="size-4" />
                </button>
              ) : null}
              {variant === "agent" ? (
                <ToolSelector disabled={false} onChange={onToolsChange} value={enabledTools} />
              ) : null}
              <ModelSelector
                disabled={targetModelLocked}
                models={models}
                onChange={onModelChange}
                value={selectedModelId}
              />
              {variant === "agent" || variant === "target" ? (
                <ReasoningSelector
                  disabled={targetModelLocked}
                  onChange={onReasoningEffortChange}
                  value={reasoningEffort}
                />
              ) : null}
            </div>
          </div>
          <Button
            aria-label={running ? "Stop generating" : "Send message"}
            className="size-10 shrink-0 rounded-full"
            disabled={!running && !canSubmit}
            onClick={running ? onStop : undefined}
            size="icon"
            type={running ? "button" : "submit"}
          >
            {running ? (
              <Square aria-hidden="true" className="size-3 fill-current" />
            ) : (
              <ArrowUp aria-hidden="true" className="size-4" />
            )}
          </Button>
        </div>
        {variant === "agent" && mentionOpen ? (
          <div className="absolute bottom-[calc(100%+8px)] left-3 z-50 w-[min(24rem,calc(100vw-2rem))] overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-xl">
            <div className="border-b px-3 py-2">
              <div className="text-xs font-medium">Reference a Prompt</div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">
                {mentionQuery !== null
                  ? "Keep typing after @ to filter the library."
                  : "Choose a prompt from the library."}
              </div>
            </div>
            <div
              aria-label="Matching prompts"
              className="max-h-64 overflow-y-auto p-1.5"
              id="prompt-mention-listbox"
              role="listbox"
            >
              {mentionSearchLoading ? (
                <div
                  className="px-2.5 py-5 text-center text-xs text-muted-foreground"
                  role="status"
                >
                  Searching words and meaning…
                </div>
              ) : mentionSearchError ? (
                <div className="px-2.5 py-5 text-center text-xs text-destructive" role="alert">
                  {mentionSearchError}
                </div>
              ) : matchingPrompts.length ? (
                matchingPrompts.map((prompt, index) => (
                  <button
                    aria-selected={index === effectiveMentionIndex}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left hover:bg-accent",
                      index === effectiveMentionIndex && "bg-accent",
                    )}
                    id={`prompt-mention-option-${prompt.id}`}
                    key={prompt.id}
                    onMouseEnter={() => setActiveMentionIndex(index)}
                    onClick={() => selectPrompt(prompt)}
                    role="option"
                    tabIndex={-1}
                    type="button"
                  >
                    <FileText
                      aria-hidden="true"
                      className="size-4 shrink-0 text-muted-foreground"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{prompt.title}</span>
                      <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                        {prompt.passages[0]?.text}
                      </span>
                      <span className="mt-0.5 block font-mono text-[10px] text-muted-foreground">
                        revision {prompt.revisionId.slice(0, 8)}
                      </span>
                    </span>
                  </button>
                ))
              ) : (
                <div className="px-2.5 py-5 text-center text-xs text-muted-foreground">
                  No prompts match this search.
                </div>
              )}
            </div>
          </div>
        ) : null}
      </form>
    </div>
  );
}

function isTargetRunQuote(quote: ChatQuote): quote is TargetRunQuote {
  return "runId" in quote;
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
      <ComposerMenu className="p-1">
        <div className="px-2 py-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          Reasoning
        </div>
        {REASONING_OPTIONS.map((option) => (
          <button
            aria-pressed={option.value === value}
            className="touch-target flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-accent"
            key={option.value}
            onClick={() => {
              onChange(option.value);
              if (detailsRef.current) detailsRef.current.open = false;
            }}
            type="button"
          >
            <span className="whitespace-nowrap text-left">{option.label}</span>
          </button>
        ))}
      </ComposerMenu>
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
          "flex size-8 cursor-pointer list-none items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground group-open/tools:bg-accent group-open/tools:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden",
          disabled && "pointer-events-none opacity-50",
        )}
      >
        <Wrench aria-hidden="true" className="size-3.5" />
      </summary>
      <ComposerMenu className="p-1.5" width="wide">
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
      </ComposerMenu>
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
