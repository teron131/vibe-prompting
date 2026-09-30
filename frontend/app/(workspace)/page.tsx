/** Opens an unpersisted general chat until the first message is sent. */

import { Chat } from "@/components/chat/chat";

export default async function ChatPage({
  searchParams,
}: {
  searchParams: Promise<{
    mode?: string | string[];
    context?: string | string[];
    targetRun?: string | string[];
  }>;
}) {
  const { mode, context, targetRun } = await searchParams;
  return (
    <Chat
      initialMode={mode === "target" ? "target" : "agent"}
      initialContextId={typeof context === "string" ? context : undefined}
      initialTargetRunId={typeof targetRun === "string" ? targetRun : undefined}
    />
  );
}
