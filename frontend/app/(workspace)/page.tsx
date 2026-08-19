/** Opens an unpersisted general chat until the first message is sent. */

import { Chat } from "@/components/chat/chat";

export default async function ChatPage({
  searchParams,
}: {
  searchParams: Promise<{ prompt?: string | string[] }>;
}) {
  const { prompt } = await searchParams;
  return <Chat initialPromptId={typeof prompt === "string" ? prompt : undefined} />;
}
