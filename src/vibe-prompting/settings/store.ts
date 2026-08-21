/** Owns durable application settings, encrypted BYOK overrides, and their effective runtime projection. */

import { homedir, hostname } from "node:os";

import { z } from "zod";

import {
  getModelStorage,
  loadBaseRuntimeConfig,
  loadRuntimeConfig,
  type ModelConfig,
  type ModelStorage,
  parseModelCatalog,
  parseModelConfig,
  type PlatformId,
  saveLocalModelSettings,
  setRuntimeConfigOverrides,
} from "../config/index.ts";
import type { Database, DatabaseClient } from "../database.ts";
import {
  decryptSecret,
  type EncryptedSecret,
  encryptSecret,
  parseEncryptedSecret,
} from "./crypto.ts";

const providerIds = ["cliproxy", "gemini", "llm"] as const satisfies readonly PlatformId[];
const providerPatchSchema = z
  .object({
    id: z.enum(providerIds),
    apiKey: z.string().trim().min(1).optional(),
    clearApiKey: z.boolean().optional(),
    baseURL: z.string().trim().optional(),
  })
  .strict()
  .superRefine((patch, context) => {
    if (patch.apiKey && patch.clearApiKey)
      context.addIssue({
        code: "custom",
        message: "apiKey and clearApiKey cannot be used together.",
      });
  });
const updateSettingsSchema = z.object({
  helperModel: z.unknown(),
  models: z.unknown(),
  providers: z.array(providerPatchSchema).optional().default([]),
});
const providerOverrideSchema = z.object({
  apiKey: z.unknown().optional(),
  baseURL: z.string().optional(),
});
const providerOverridesSchema = z
  .partialRecord(z.enum(providerIds), providerOverrideSchema)
  .default({});

type ProviderOverride = { apiKey?: EncryptedSecret; baseURL?: string };
type ProviderOverrides = Partial<Record<PlatformId, ProviderOverride>>;
type SettingsRow = {
  helperModel: unknown;
  modelCatalog: unknown;
  providerOverrides: unknown;
};

export type ProviderSettings = {
  id: PlatformId;
  label: string;
  baseURL: string;
  configured: boolean;
  credentialSource: "byok" | "deployment" | "missing";
};

export type ApplicationSettings = {
  helperModel: ModelConfig;
  modelStorage: ModelStorage;
  models: ModelConfig[];
  providers: ProviderSettings[];
  canSaveCredentials: boolean;
};

export type UpdateApplicationSettings = z.infer<typeof updateSettingsSchema>;

export class ApplicationSettingsStore {
  readonly #database: Database;
  readonly #environment: NodeJS.ProcessEnv;
  #helperModel: ModelConfig = { id: "", platform: "llm" };
  #models: ModelConfig[] = [];
  #providerOverrides: ProviderOverrides = {};

  constructor(database: Database, environment: NodeJS.ProcessEnv = process.env) {
    this.#database = database;
    this.#environment = environment;
  }

  async initialize(): Promise<void> {
    const baseConfig = loadBaseRuntimeConfig(this.#environment);
    const row = await this.#database.run(async (sql) => {
      await sql`
        INSERT INTO application_settings (singleton, model_catalog, helper_model, provider_overrides)
        VALUES (true, ${sql.json(baseConfig.models)}, ${sql.json(baseConfig.helperModel)}, ${sql.json({})})
        ON CONFLICT (singleton) DO UPDATE
        SET helper_model = EXCLUDED.helper_model
        WHERE application_settings.helper_model IS NULL
      `;
      return readSettings(sql);
    });
    if (!row) throw new Error("Application settings could not be initialized.");
    const modelStorage = getModelStorage(this.#environment);
    this.#models =
      modelStorage === "database" ? parseModelCatalog(row.modelCatalog) : baseConfig.models;
    this.#helperModel =
      modelStorage === "database" ? parseModelConfig(row.helperModel) : baseConfig.helperModel;
    this.#providerOverrides = parseProviderOverrides(row.providerOverrides);
    this.#applyRuntimeOverlay();
  }

  get(): ApplicationSettings {
    const effective = loadRuntimeConfig(this.#environment);
    const base = loadBaseRuntimeConfig(this.#environment);
    return {
      helperModel: this.#helperModel,
      modelStorage: getModelStorage(this.#environment),
      models: this.#models,
      providers: providerIds.map((id) => {
        const platform = effective.platforms[id];
        const override = this.#providerOverrides[id];
        return {
          id,
          label: platform.label,
          baseURL: platform.baseURL,
          configured: Boolean(platform.apiKey && platform.baseURL),
          credentialSource: override?.apiKey
            ? "byok"
            : base.platforms[id].apiKey
              ? "deployment"
              : "missing",
        };
      }),
      canSaveCredentials: Boolean(readEncryptionSecret(this.#environment)),
    };
  }

  async update(value: unknown): Promise<ApplicationSettings> {
    const input = updateSettingsSchema.parse(value);
    const helperModel = parseModelConfig(input.helperModel);
    const models = parseModelCatalog(input.models);
    const encryptionSecret = readEncryptionSecret(this.#environment);
    const providerPatches = input.providers.map((patch) => {
      if (patch.apiKey && !encryptionSecret)
        throw new SettingsError(
          "Credential saving requires BYOK_ENCRYPTION_KEY or APP_PASSWORD.",
          400,
        );
      return {
        ...patch,
        ...(patch.apiKey &&
          encryptionSecret && { encryptedApiKey: encryptSecret(patch.apiKey, encryptionSecret) }),
        ...(patch.baseURL !== undefined && {
          normalizedBaseURL: patch.baseURL
            ? parseHttpUrl(patch.baseURL, `${patch.id} base URL`)
            : "",
        }),
      };
    });
    if (getModelStorage(this.#environment) === "yaml")
      await saveLocalModelSettings(models, helperModel);

    const row = await this.#database.transaction(async (sql) => {
      const current = await readSettings(sql, true);
      const overrides = current ? parseProviderOverrides(current.providerOverrides) : {};
      for (const patch of providerPatches) {
        const override = { ...overrides[patch.id] };
        if (patch.clearApiKey) delete override.apiKey;
        if (patch.encryptedApiKey) override.apiKey = patch.encryptedApiKey;
        if (patch.normalizedBaseURL !== undefined) {
          if (patch.normalizedBaseURL) override.baseURL = patch.normalizedBaseURL;
          else delete override.baseURL;
        }
        if (override.apiKey || override.baseURL) overrides[patch.id] = override;
        else delete overrides[patch.id];
      }
      const [saved] = await sql<SettingsRow[]>`
        INSERT INTO application_settings (singleton, model_catalog, helper_model, provider_overrides)
        VALUES (true, ${sql.json(models)}, ${sql.json(helperModel)}, ${sql.json(overrides)})
        ON CONFLICT (singleton) DO UPDATE
        SET model_catalog = EXCLUDED.model_catalog,
            helper_model = EXCLUDED.helper_model,
            provider_overrides = EXCLUDED.provider_overrides
        RETURNING model_catalog, helper_model, provider_overrides
      `;
      if (!saved) throw new Error("Application settings could not be saved.");
      return saved;
    });

    this.#models = models;
    this.#helperModel = parseModelConfig(row.helperModel);
    this.#providerOverrides = parseProviderOverrides(row.providerOverrides);
    this.#applyRuntimeOverlay();
    return this.get();
  }

  #applyRuntimeOverlay(): void {
    const encryptionSecret = readEncryptionSecret(this.#environment);
    const platforms = Object.fromEntries(
      providerIds.flatMap((id) => {
        const override = this.#providerOverrides[id];
        if (!override) return [];
        const apiKey =
          override.apiKey && encryptionSecret
            ? decryptSecret(override.apiKey, encryptionSecret)
            : undefined;
        return [
          [
            id,
            { ...(apiKey && { apiKey }), ...(override.baseURL && { baseURL: override.baseURL }) },
          ],
        ];
      }),
    );
    setRuntimeConfigOverrides({ helperModel: this.#helperModel, models: this.#models, platforms });
  }
}

export class SettingsError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = "SettingsError";
    this.statusCode = statusCode;
  }
}

function parseProviderOverrides(value: unknown): ProviderOverrides {
  const parsed = providerOverridesSchema.parse(value);
  const overrides: ProviderOverrides = {};
  for (const id of providerIds) {
    const override = parsed[id];
    if (!override) continue;
    overrides[id] = {
      ...(override.apiKey !== undefined && { apiKey: parseEncryptedSecret(override.apiKey) }),
      ...(override.baseURL !== undefined && { baseURL: override.baseURL }),
    };
  }
  return overrides;
}

async function readSettings(sql: DatabaseClient, lock = false): Promise<SettingsRow | undefined> {
  const rows = lock
    ? await sql<
        SettingsRow[]
      >`SELECT model_catalog, helper_model, provider_overrides FROM application_settings WHERE singleton = true FOR UPDATE`
    : await sql<
        SettingsRow[]
      >`SELECT model_catalog, helper_model, provider_overrides FROM application_settings WHERE singleton = true`;
  return rows[0];
}

function readEncryptionSecret(environment: NodeJS.ProcessEnv): string | undefined {
  const configured =
    environment.BYOK_ENCRYPTION_KEY?.trim() || environment.APP_PASSWORD?.trim() || undefined;
  if (configured) return configured;
  return environment.NODE_ENV === "development"
    ? `vibe-prompting-local:${hostname()}:${homedir()}`
    : undefined;
}

function parseHttpUrl(value: string, label: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new SettingsError(`${label} must be a valid URL.`, 400);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw new SettingsError(`${label} must use HTTP or HTTPS.`, 400);
  return url.toString();
}
