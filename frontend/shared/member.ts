/** Owns browser-facing fallback labels for shared-workspace members. */

export function memberDisplayName(name: string | null | undefined): string {
  return name?.trim() || "Another member";
}
