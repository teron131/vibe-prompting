/** Turns stored context revision provenance into concise viewer-relative attribution. */

import type { ContextRevisionSummary } from "@/contracts/contexts";
import { memberDisplayName } from "@/shared/member";

export function contextRevisionAuthorLabel(revision: ContextRevisionSummary): string {
  if (revision.source === "human") {
    if (revision.createdByCurrentUser) return "You";
    return memberDisplayName(revision.createdByName);
  }
  if (revision.createdByCurrentUser) return "AI for you";
  return revision.createdByName?.trim()
    ? `AI for ${revision.createdByName.trim()}`
    : "AI for another member";
}
