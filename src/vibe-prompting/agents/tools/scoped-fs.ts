/** Owns one isolated in-memory document; callers bind its tools and persistence without granting access to other documents or the host filesystem. */

import { applyHashlineEdits, type HashlineEdit } from "./hashline.ts";

export type ScopedDocument = {
  applyEdits(edits: HashlineEdit[]): string;
  read(): string;
};

/** Creates a private text scope whose failed edit batches leave its content unchanged. */
export function createScopedDocument(text: string): ScopedDocument {
  let current = text;
  return {
    applyEdits(edits) {
      current = applyHashlineEdits(current, edits);
      return current;
    },
    read() {
      return current;
    },
  };
}
