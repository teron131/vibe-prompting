/** Turns stored prompt revision provenance into concise viewer-relative attribution. */

import type { PromptRevisionSummary } from "@/contracts/prompts";
import { memberDisplayName } from "@/shared/member";

export function promptRevisionAuthorLabel(revision: PromptRevisionSummary): string {
  if (revision.source === "human") {
    if (revision.createdByCurrentUser) return "You";
    return memberDisplayName(revision.createdByName);
  }
  if (revision.createdByCurrentUser) return "AI for you";
  return revision.createdByName?.trim()
    ? `AI for ${revision.createdByName.trim()}`
    : "AI for another member";
}
