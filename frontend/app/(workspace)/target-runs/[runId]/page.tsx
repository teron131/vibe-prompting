/** Restores one durable Target Run in the reused conversation UI without treating it as general chat history. */

import { Chat } from "@/components/chat/chat";

export default async function TargetRunPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  return <Chat initialMode="target" initialTargetRunId={runId} />;
}
