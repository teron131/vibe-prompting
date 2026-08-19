/** Resolves configured runtime model IDs to canonical Models.dev identities without making display metadata a runtime execution dependency. */

import { z } from "zod";

const MODELS_DEV_URL = "https://models.dev/models.json";
const modelsDevModelSchema = z.object({ id: z.string(), name: z.string().trim().min(1) });
const modelsDevCatalogSchema = z.record(z.string(), modelsDevModelSchema);

type ModelsDevCatalog = z.infer<typeof modelsDevCatalogSchema>;

export type ModelIdentity = { known: boolean; label: string; provider: string };

let catalogPromise: Promise<ModelsDevCatalog> | undefined;

export async function resolveModelCatalogId(id: string): Promise<string> {
  const match = findCatalogModel(id, await loadModelsDevCatalog());
  if (!match) throw new Error(`Models.dev does not contain configured model: ${id}.`);
  return match.catalogId;
}

export async function resolveModelIdentities(ids: readonly string[]): Promise<ModelIdentity[]> {
  let catalog: ModelsDevCatalog | undefined;
  try {
    catalog = await loadModelsDevCatalog();
  } catch (error) {
    console.warn("Models.dev catalog unavailable; using model IDs for display.", error);
  }
  return ids.map((id) => resolveModelIdentity(id, catalog));
}

async function loadModelsDevCatalog(): Promise<ModelsDevCatalog> {
  catalogPromise ??= fetch(MODELS_DEV_URL, { signal: AbortSignal.timeout(5000) })
    .then(async (response) => {
      if (!response.ok) throw new Error(`Models.dev returned HTTP ${response.status}.`);
      return modelsDevCatalogSchema.parse(await response.json());
    })
    .catch((error) => {
      catalogPromise = undefined;
      throw error;
    });
  return catalogPromise;
}

function resolveModelIdentity(id: string, catalog: ModelsDevCatalog | undefined): ModelIdentity {
  const match = catalog ? findCatalogModel(id, catalog) : undefined;
  if (match) {
    return {
      known: true,
      label: match.model.name,
      provider: match.catalogId.split("/", 1)[0],
    };
  }
  return {
    known: false,
    label: humanizeModelId(id),
    provider: id.includes("/") ? id.split("/", 1)[0] : "model",
  };
}

function findCatalogModel(
  id: string,
  catalog: ModelsDevCatalog,
): { catalogId: string; model: z.infer<typeof modelsDevModelSchema> } | undefined {
  const exact = catalog[id];
  if (exact) return { catalogId: id, model: exact };

  const suffixMatches = Object.entries(catalog).filter(([catalogId]) =>
    catalogId.endsWith(`/${id}`),
  );
  if (suffixMatches.length === 1) {
    const [catalogId, model] = suffixMatches[0];
    return { catalogId, model };
  }

  const normalizedId = normalizeModelId(id.split("/").at(-1) ?? id);
  const normalizedMatches = Object.entries(catalog).filter(
    ([catalogId]) => normalizeModelId(catalogId.split("/").at(-1) ?? catalogId) === normalizedId,
  );
  if (normalizedMatches.length !== 1) return undefined;
  const [catalogId, model] = normalizedMatches[0];
  return { catalogId, model };
}

function normalizeModelId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function humanizeModelId(id: string): string {
  return (id.split("/").at(-1) ?? id)
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}
