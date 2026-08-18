/** Loads one persisted Lucide icon through the server-owned SVG endpoint. */

import { cn } from "@/components/ui/utils";

const DEFAULT_CHAT_ICON = "message-circle";
const ICON_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function ChatHistoryIcon({ className, name }: { className?: string; name: string }) {
  const iconName = ICON_NAME_PATTERN.test(name) ? name : DEFAULT_CHAT_ICON;
  const mask = `url("/api/chat-icon/${iconName}") center / contain no-repeat`;

  return (
    <span
      aria-hidden="true"
      className={cn("block size-4 shrink-0 bg-current", className)}
      style={{ mask }}
    />
  );
}
