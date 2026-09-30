/** Migrates browser-owned workspace drafts and preferences to context references without dropping unsaved text or selected records. */

/** Rewrites each saved value in place once; callers consume only the current context contract. */
export function readContextStorage(key: string): string | null {
  const storage = window.localStorage;
  let source = storage.getItem(key);
  if (source === null && key === "vibe-prompting:context-panel-width") {
    source = storage.getItem("vibe-prompting:prompt-panel-width");
    if (source !== null) {
      storage.setItem(key, source);
      storage.removeItem("vibe-prompting:prompt-panel-width");
    }
  }
  if (source === null) return null;
  const result = JSON.stringify(migrateReferences(JSON.parse(source)));
  if (result !== source) storage.setItem(key, result);
  return result;
}

function migrateReferences(value: unknown, field = ""): unknown {
  if (Array.isArray(value)) return value.map((item) => migrateReferences(item, field));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => {
        const currentKey = REFERENCE_KEYS[key] ?? key;
        return [currentKey, migrateReferences(item, currentKey)];
      }),
    );
  }
  if (field === "enabledTools" && value === "prompt-library") return "context-library";
  if (field === "signature" && typeof value === "string") {
    return JSON.stringify(migrateReferences(JSON.parse(value)));
  }
  return value;
}

const REFERENCE_KEYS: Record<string, string> = {
  promptId: "contextId",
  promptRevisionId: "contextRevisionId",
  activePromptId: "activeContextId",
};
