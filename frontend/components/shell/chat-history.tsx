/** Owns cursor history, date grouping, text search, and optimistic stop-before-delete behavior for the sidebar. */

"use client";

import { LoaderCircle, Search, Trash2, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { ChatHistoryIcon } from "@/components/chat/history-icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/components/ui/utils";
import type {
  ChatPage,
  ChatSearchResponse,
  ChatSummary,
  DeleteChatResponse,
} from "@/contracts/chat";
import { createApiRequester, createErrorReader } from "@/shared/api";

const chatHistoryApi = createApiRequester({ cache: "no-store" }, "Chat history request failed.");
const readError = createErrorReader("Chat history request failed.");

export function ChatHistory() {
  const pathname = usePathname();
  const router = useRouter();
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<ChatSummary[]>([]);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string>();
  const deleteConfirmationRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const page = await chatHistoryApi.json<ChatPage>("/api/chats?limit=30");
      setChats(page.chats);
      setNextCursor(page.nextCursor);
    } catch (error) {
      toast.error(readError(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    window.addEventListener("vibe:history", load);
    return () => window.removeEventListener("vibe:history", load);
  }, [load]);

  useEffect(() => {
    if (!searching || !query.trim()) {
      setSearchResults([]);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void chatHistoryApi
        .json<ChatSearchResponse>(`/api/chat-search?q=${encodeURIComponent(query)}`, {
          signal: controller.signal,
        })
        .then(({ chats: results }) => setSearchResults(results))
        .catch((error) => {
          if (!controller.signal.aborted) toast.error(readError(error));
        });
    }, 200);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [query, searching]);

  useEffect(() => {
    if (!confirmingDeleteId) return;
    function dismissDeleteConfirmation(event: PointerEvent) {
      if (!deleteConfirmationRef.current?.contains(event.target as Node)) {
        setConfirmingDeleteId(undefined);
      }
    }
    document.addEventListener("pointerdown", dismissDeleteConfirmation);
    return () => document.removeEventListener("pointerdown", dismissDeleteConfirmation);
  }, [confirmingDeleteId]);

  const visibleChats = searching && query.trim() ? searchResults : chats;
  const groups = useMemo(() => groupChats(visibleChats), [visibleChats]);

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await chatHistoryApi.json<ChatPage>(
        `/api/chats?limit=30&cursor=${encodeURIComponent(nextCursor)}`,
      );
      setChats((current) => [...current, ...page.chats]);
      setNextCursor(page.nextCursor);
    } catch (error) {
      toast.error(readError(error));
    } finally {
      setLoadingMore(false);
    }
  }

  async function deleteChat(chat: ChatSummary) {
    setConfirmingDeleteId(undefined);
    const previousChats = chats;
    const previousResults = searchResults;
    setChats((current) => current.filter(({ id }) => id !== chat.id));
    setSearchResults((current) => current.filter(({ id }) => id !== chat.id));
    if (pathname === `/chat/${chat.id}`) router.push("/");
    try {
      await chatHistoryApi.json<DeleteChatResponse>(`/api/chat?id=${encodeURIComponent(chat.id)}`, {
        method: "DELETE",
      });
      router.refresh();
    } catch (error) {
      setChats(previousChats);
      setSearchResults(previousResults);
      toast.error(readError(error));
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between px-1.5 py-2">
        <div className="flex min-w-0 items-baseline gap-1.5">
          <span className="truncate text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Your Chats
          </span>
          <span className="shrink-0 text-[10px] text-muted-foreground/75">Private</span>
        </div>
        <button
          aria-label={searching ? "Close chat search" : "Search chats"}
          className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-sidebar-accent"
          onClick={() => {
            setSearching((value) => !value);
            setQuery("");
            setConfirmingDeleteId(undefined);
          }}
          type="button"
        >
          {searching ? (
            <X aria-hidden="true" className="size-3.5" />
          ) : (
            <Search aria-hidden="true" className="size-3.5" />
          )}
        </button>
      </div>
      {searching ? (
        <div className="px-2 pb-2">
          <Input
            aria-label="Search chat history"
            autoFocus
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search history"
            value={query}
          />
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-2">
        {loading ? (
          <HistorySkeleton />
        ) : visibleChats.length === 0 ? (
          <p className="px-2 py-3 text-xs text-muted-foreground">
            {searching && query
              ? "No matching chats."
              : "Your completed and stopped chats will appear here."}
          </p>
        ) : (
          groups.map((group) => (
            <section className="mb-3" key={group.label}>
              <h2 className="px-2 py-1 text-[10px] font-medium text-muted-foreground">
                {group.label}
              </h2>
              {group.chats.map((chat) => (
                <div
                  className="group relative"
                  key={chat.id}
                  onKeyDown={(event) => {
                    if (confirmingDeleteId === chat.id && event.key === "Escape") {
                      setConfirmingDeleteId(undefined);
                    }
                  }}
                >
                  <Link
                    className={cn(
                      "flex min-w-0 items-center gap-1.5 rounded-md px-2 py-1.5 text-xs hover:bg-sidebar-accent",
                      pathname === `/chat/${chat.id}` && "bg-sidebar-accent",
                    )}
                    href={`/chat/${chat.id}`}
                  >
                    <ChatHistoryIcon name={chat.icon} />
                    <span className="truncate">{chat.title}</span>
                  </Link>
                  {confirmingDeleteId === chat.id ? (
                    <div
                      className="absolute right-1 top-1/2 flex -translate-y-1/2 items-center gap-0.5 rounded-md bg-sidebar-accent"
                      ref={deleteConfirmationRef}
                    >
                      <button
                        aria-label="Cancel delete"
                        autoFocus
                        className="grid size-7 place-items-center rounded-md bg-sidebar-accent text-muted-foreground hover:text-foreground"
                        onClick={() => setConfirmingDeleteId(undefined)}
                        type="button"
                      >
                        <X aria-hidden="true" className="size-3.5" />
                      </button>
                      <button
                        aria-label={`Confirm delete ${chat.title}`}
                        className="grid size-7 place-items-center rounded-md bg-sidebar-accent text-destructive hover:bg-destructive/10"
                        onClick={() => void deleteChat(chat)}
                        type="button"
                      >
                        <Trash2 aria-hidden="true" className="size-3.5" />
                      </button>
                    </div>
                  ) : (
                    <button
                      aria-label={`Delete ${chat.title}`}
                      className="pointer-events-none absolute right-1 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-md bg-sidebar-accent text-muted-foreground opacity-0 transition-colors hover:bg-destructive/10 hover:text-destructive group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100"
                      onClick={() => setConfirmingDeleteId(chat.id)}
                      type="button"
                    >
                      <Trash2 aria-hidden="true" className="size-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </section>
          ))
        )}
        {!searching && nextCursor ? (
          <Button
            className="mx-2 w-[calc(100%-1rem)]"
            disabled={loadingMore}
            onClick={loadMore}
            size="sm"
            variant="ghost"
          >
            {loadingMore ? (
              <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" />
            ) : null}
            Load older
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function HistorySkeleton() {
  return (
    <div aria-label="Loading chat history" className="space-y-2 px-2 py-3">
      {[0, 1, 2, 3].map((item) => (
        <div className="h-8 animate-pulse rounded-md bg-sidebar-accent" key={item} />
      ))}
    </div>
  );
}

function groupChats(chats: ChatSummary[]) {
  const now = new Date();
  const today = startOfDay(now);
  const yesterday = new Date(today.getTime() - 86_400_000);
  const sevenDays = new Date(today.getTime() - 7 * 86_400_000);
  const thirtyDays = new Date(today.getTime() - 30 * 86_400_000);
  const groups = [
    { label: "Today", chats: [] as ChatSummary[], test: (date: Date) => date >= today },
    { label: "Yesterday", chats: [] as ChatSummary[], test: (date: Date) => date >= yesterday },
    { label: "Last 7 Days", chats: [] as ChatSummary[], test: (date: Date) => date >= sevenDays },
    { label: "Last 30 Days", chats: [] as ChatSummary[], test: (date: Date) => date >= thirtyDays },
    { label: "Older", chats: [] as ChatSummary[], test: () => true },
  ];
  for (const chat of chats) {
    const group = groups.find(({ test }) => test(new Date(chat.updatedAt)));
    group?.chats.push(chat);
  }
  return groups.filter(({ chats: items }) => items.length > 0);
}

function startOfDay(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}
