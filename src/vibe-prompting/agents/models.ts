/** Resolves shared agent model references against configured IDs and labels without depending on any evaluation workflow. */

import type { ModelContext } from "../clients/llm/context.ts";
import { resolveModelIdentities } from "../clients/llm/models-dev.ts";

/** Identifies configured models by either their canonical ID or display label. */
export type ConfiguredModelReference = { id: string; label: string };

/** Resolves a model ID or unique display label and rejects unknown or ambiguous references. */
export function resolveConfiguredModelId(
  reference: string,
  models: readonly ConfiguredModelReference[],
): string {
  const normalized = reference.trim().toLocaleLowerCase();
  const idMatch = models.find((model) => model.id.toLocaleLowerCase() === normalized);
  if (idMatch) return idMatch.id;
  const labelMatches = models.filter((model) => model.label.toLocaleLowerCase() === normalized);
  if (labelMatches.length === 1) return labelMatches[0].id;
  if (labelMatches.length > 1)
    throw new Error(`Configured model label is ambiguous: ${reference}. Use its model ID.`);
  throw new Error(`Unknown configured model: ${reference}.`);
}
/** Loads canonical model labels for agent tools without exposing provider metadata. */
export async function getConfiguredModelReferences(modelContext: ModelContext) {
  const { models } = modelContext.readConfig();
  const identities = await resolveModelIdentities(models.map(({ id }) => id));
  return models.map(({ id }, index) => ({ id, label: identities[index]?.label ?? id }));
}
