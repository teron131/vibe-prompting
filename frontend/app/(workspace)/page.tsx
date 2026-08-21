/** Opens an unpersisted general chat until the first message is sent. */

import { Chat } from "@/components/chat/chat";

export default async function ChatPage({
  searchParams,
}: {
  searchParams: Promise<{
    mode?: string | string[];
    prompt?: string | string[];
    targetRun?: string | string[];
  }>;
}) {
  const { mode, prompt, targetRun } = await searchParams;
  return (
    <Chat
      initialMode={mode === "target" ? "target" : "agent"}
      initialPromptId={typeof prompt === "string" ? prompt : undefined}
      initialTargetRunId={typeof targetRun === "string" ? targetRun : undefined}
    />
  );
}
