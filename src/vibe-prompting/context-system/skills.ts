/** Recognizes standard SKILL.md metadata in versioned Markdown without coupling saved content or browser editing to an agent framework. */

import { parseDocument } from "yaml";

export type SkillMetadata = { name: string; description: string };

export class SkillFormatError extends Error {
  readonly statusCode = 400;

  constructor(message: string) {
    super(message);
    this.name = "SkillFormatError";
  }
}

/** Returns metadata for a skill, leaves ordinary prompts alone, and rejects malformed skill manifests before they become active revisions. */
export function readSkillMetadata(markdown: string): SkillMetadata | undefined {
  const normalized = markdown.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  const opening = /^---[\t ]*\n/.exec(normalized);
  if (!opening) return undefined;
  const remaining = normalized.slice(opening[0].length);
  const closing = /^---[\t ]*(?:\n|$)/m.exec(remaining);
  const frontmatter = remaining.slice(0, closing?.index);
  if (!/^(?:name|description|"name"|"description"|'name'|'description')\s*:/m.test(frontmatter))
    return undefined;
  if (!closing)
    throw new SkillFormatError("Close the skill frontmatter with a line containing ---.");
  const document = parseDocument(frontmatter);
  if (document.errors.length) throw new SkillFormatError("Skill frontmatter must be valid YAML.");
  let metadata: Record<string, unknown> | null;
  try {
    metadata = document.toJS({ maxAliasCount: 0 }) as Record<string, unknown> | null;
  } catch (cause) {
    throw new SkillFormatError(
      cause instanceof Error ? cause.message : "Skill frontmatter cannot contain YAML aliases.",
    );
  }
  const name = typeof metadata?.name === "string" ? metadata.name : "";
  const description = typeof metadata?.description === "string" ? metadata.description.trim() : "";
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) || name.length > 64)
    throw new SkillFormatError(
      "Skill name must be 1–64 lowercase letters, numbers, or single hyphens between words.",
    );
  if (!description || description.length > 1024)
    throw new SkillFormatError(
      "Skill description must be 1–1024 characters and explain when to use it.",
    );
  if (!remaining.slice(closing.index + closing[0].length).trim())
    throw new SkillFormatError("Add the skill instructions below its frontmatter.");
  return { name, description };
}

/** Produces a complete editable starter manifest using the same format consumed by the SDK. */
export function createSkillMarkdown(
  name: string,
  description: string,
  instructions: string,
): string {
  return `---\nname: ${JSON.stringify(name)}\ndescription: ${JSON.stringify(description)}\n---\n\n${instructions}`;
}
