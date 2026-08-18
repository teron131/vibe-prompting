/** Restores one general chat conversation while live activity remains process-local to the server. */

import { Chat } from "@/components/chat/chat";

export default async function SavedChatPage({ params }: { params: Promise<{ chatId: string }> }) {
  const { chatId } = await params;
  return <Chat chatId={chatId} />;
}
