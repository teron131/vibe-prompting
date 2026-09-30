/** Owns context-specific viewer projection and conflict-aware browser error responses. */

import { projectServerError } from "vibe-prompting/server";

import { NO_STORE_HEADERS } from "@/server/errors";

/** Replaces the stored user identifier with the only viewer-relative identity signal the browser needs. */
export function projectContextRevisionForViewer<Revision extends { createdByUserId: string }>(
  revision: Revision,
  viewerUserId: string,
): Omit<Revision, "createdByUserId"> & {
  createdByCurrentUser: boolean;
} {
  const { createdByUserId, ...browserRevision } = revision;
  return {
    ...browserRevision,
    createdByCurrentUser: createdByUserId === viewerUserId,
  };
}

export function contextErrorResponse(error: unknown): Response {
  const projected = projectServerError(error, "Context storage failed.");
  const currentActiveRevisionId =
    projected.status === 409 &&
    error &&
    typeof error === "object" &&
    "currentActiveRevisionId" in error &&
    typeof error.currentActiveRevisionId === "string"
      ? error.currentActiveRevisionId
      : undefined;
  return Response.json(
    { code: projected.code, error: projected.message, currentActiveRevisionId },
    { headers: NO_STORE_HEADERS, status: projected.status },
  );
}
