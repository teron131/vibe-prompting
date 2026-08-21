/** Loads model catalogues, provider credentials, runtime overrides, and YAML-backed model configuration. */

import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { rename, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

import { config as loadDotenv } from "dotenv";
import { parse, parseDocument } from "yaml";
import { z } from "zod";

export const CONFIG_PATH = ".config.yaml";
export const DEFAULT_CLIPROXYAPI_BASE_URL = "http://localhost:8317/v1";
export const GEMINI_OPENAI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/";

loadDotenv({ override: false, path: resolveRuntimeFile(".env"), quiet: true });

const platformIds = ["cliproxy", "gemini", "llm"] as const;

export type PlatformId = (typeof platformIds)[number];

export type PlatformConfig = {
  id: PlatformId;
  label: string;
  apiKey: string | undefined;
  baseURL: string;
};

export type ConfiguredPlatform = PlatformConfig & { apiKey: string };

const modelConfigSchema = z
  .object({
    id: z.string().trim().min(1),
    platform: z.enum(platformIds),
  })
  .strict();

const modelCatalogSchema = z
  .array(modelConfigSchema)
  .min(1)
  .superRefine((models, context) => {
    const seen = new Set<string>();
    for (const [index, model] of models.entries()) {
      if (seen.has(model.id)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate model ID: ${model.id}.`,
          path: [index, "id"],
        });
      }
      seen.add(model.id);
    }
  });

const fileConfigSchema = z
  .object({
    models: modelCatalogSchema,
    helper_model: modelConfigSchema,
    embeddingModel: modelConfigSchema,
  })
  .strict();

export type ModelConfig = z.infer<typeof modelConfigSchema>;

export type ModelStorage = "database" | "yaml";

export type RuntimeConfig = {
  models: ModelConfig[];
  helperModel: ModelConfig;
  embeddingModel: ModelConfig;
  platforms: Record<PlatformId, PlatformConfig>;
  exa: {
    apiKey: string | undefined;
  };
};

export type RuntimeConfigOverrides = {
  helperModel?: ModelConfig;
  models?: ModelConfig[];
  platforms?: Partial<Record<PlatformId, Partial<Pick<PlatformConfig, "apiKey" | "baseURL">>>>;
};

let runtimeOverrides: RuntimeConfigOverrides = {};

const optionalText = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().trim().min(1).optional(),
);

const environmentSchema = z.object({
  LLM_API_KEY: optionalText,
  LLM_BASE_URL: optionalText,
  GEMINI_API_KEY: optionalText,
  GOOGLE_API_KEY: optionalText,
  CLIPROXYAPI_API_KEY: optionalText,
  CLIPROXYAPI_BASE_URL: optionalText,
  EXA_API_KEY: optionalText,
  MODEL_CONFIG_YAML: optionalText,
});

/** Reads user-editable models separately from provider secrets and endpoints. */
export function loadRuntimeConfig(
  environment: NodeJS.ProcessEnv = process.env,
  configPath: string = resolveRuntimeFile(CONFIG_PATH),
): RuntimeConfig {
  return applyRuntimeOverrides(loadBaseRuntimeConfig(environment, configPath));
}

/** Loads environment and YAML defaults without applying database-owned settings. */
export function loadBaseRuntimeConfig(
  environment: NodeJS.ProcessEnv = process.env,
  configPath: string = resolveRuntimeFile(CONFIG_PATH),
): RuntimeConfig {
  const values = environmentSchema.parse(environment);
  const fileConfig = loadFileConfig(configPath, values.MODEL_CONFIG_YAML);
  const geminiApiKey = values.GEMINI_API_KEY ?? values.GOOGLE_API_KEY;

  const config: RuntimeConfig = {
    models: fileConfig.models,
    helperModel: fileConfig.helper_model,
    embeddingModel: fileConfig.embeddingModel,
    platforms: {
      cliproxy: {
        id: "cliproxy",
        label: "CLIProxyAPI",
        apiKey: values.CLIPROXYAPI_API_KEY,
        baseURL: parseHttpUrl(
          values.CLIPROXYAPI_BASE_URL ?? DEFAULT_CLIPROXYAPI_BASE_URL,
          "CLIPROXYAPI_BASE_URL",
        ),
      },
      gemini: {
        id: "gemini",
        label: "Gemini API",
        apiKey: geminiApiKey,
        baseURL: GEMINI_OPENAI_BASE_URL,
      },
      llm: {
        id: "llm",
        label: "LLM API",
        apiKey: values.LLM_API_KEY,
        baseURL: values.LLM_BASE_URL ? parseHttpUrl(values.LLM_BASE_URL, "LLM_BASE_URL") : "",
      },
    },
    exa: {
      apiKey: values.EXA_API_KEY,
    },
  };
  return config;
}

/** Replaces the database-owned runtime overlay after application settings have initialized or changed. */
export function setRuntimeConfigOverrides(overrides: RuntimeConfigOverrides): void {
  runtimeOverrides = structuredClone(overrides);
}

/** Returns the durable owner used for model edits in the current runtime. */
export function getModelStorage(environment: NodeJS.ProcessEnv = process.env): ModelStorage {
  return environmentSchema.parse(environment).MODEL_CONFIG_YAML ? "database" : "yaml";
}

/** Validates a complete user-managed model catalogue. */
export function parseModelCatalog(value: unknown): ModelConfig[] {
  return modelCatalogSchema.parse(value);
}

/** Validates one model configuration used by a specialized runtime role. */
export function parseModelConfig(value: unknown): ModelConfig {
  return modelConfigSchema.parse(value);
}

/** Atomically replaces the local YAML model settings while retaining unrelated specialized models and comments. */
export async function saveLocalModelSettings(
  models: ModelConfig[],
  helperModel: ModelConfig,
  configPath: string = resolveRuntimeFile(CONFIG_PATH),
): Promise<void> {
  const source = readFileSync(configPath, "utf8");
  const document = parseDocument(source);
  document.set("models", parseModelCatalog(models));
  document.set("helper_model", parseModelConfig(helperModel));
  fileConfigSchema.parse(document.toJS());
  const temporaryPath = join(dirname(configPath), `.${basename(configPath)}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporaryPath, document.toString(), { encoding: "utf8", mode: 0o600 });
    await rename(temporaryPath, configPath);
  } catch (error) {
    try {
      await unlink(temporaryPath);
    } catch {}
    throw error;
  }
}

/** Selects a model's preferred configured platform or the generic credential fallback. */
export function resolveModelPlatform(
  model: ModelConfig,
  config: RuntimeConfig,
): ConfiguredPlatform {
  const preferred = config.platforms[model.platform];
  const platform = isPlatformConfigured(preferred)
    ? preferred
    : model.platform !== "llm" && isPlatformConfigured(config.platforms.llm)
      ? config.platforms.llm
      : undefined;
  if (!platform?.apiKey) {
    throw new Error(
      `No configured platform can serve ${model.id}. Set ${credentialHint(model.platform)}.`,
    );
  }
  return { ...platform, apiKey: platform.apiKey };
}

/** Loads and validates the private YAML catalogue with an actionable missing-file error. */
function loadFileConfig(
  configPath: string,
  configuredSource?: string,
): z.infer<typeof fileConfigSchema> {
  let source: string;
  if (configuredSource) {
    source = configuredSource;
  } else {
    try {
      source = readFileSync(configPath, "utf8");
    } catch (error) {
      throw new Error(
        `Unable to read ${configPath}. Copy .config.yaml.example to .config.yaml first.`,
        { cause: error },
      );
    }
  }

  try {
    return fileConfigSchema.parse(parse(source));
  } catch (error) {
    throw new Error(`Invalid model configuration in ${configPath}.`, { cause: error });
  }
}

function parseHttpUrl(value: string, name: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid URL.`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${name} must use HTTP or HTTPS.`);
  }
  return url.toString();
}

function isPlatformConfigured(platform: PlatformConfig): boolean {
  return Boolean(platform.apiKey && platform.baseURL);
}

function applyRuntimeOverrides(config: RuntimeConfig): RuntimeConfig {
  const platforms = { ...config.platforms };
  for (const id of platformIds) {
    const override = runtimeOverrides.platforms?.[id];
    if (override) platforms[id] = { ...platforms[id], ...override };
  }
  return {
    ...config,
    helperModel: runtimeOverrides.helperModel ?? config.helperModel,
    models: runtimeOverrides.models ?? config.models,
    platforms,
  };
}

function credentialHint(platformId: PlatformId): string {
  if (platformId === "cliproxy") {
    return "CLIPROXYAPI_API_KEY or LLM_API_KEY and LLM_BASE_URL";
  }
  if (platformId === "gemini") {
    return "GEMINI_API_KEY or LLM_API_KEY and LLM_BASE_URL";
  }
  return "LLM_API_KEY and LLM_BASE_URL";
}

function resolveRuntimeFile(filename: string): string {
  const local = resolve(/* turbopackIgnore: true */ process.cwd(), filename);
  if (existsSync(/* turbopackIgnore: true */ local)) return local;
  return resolve(/* turbopackIgnore: true */ process.cwd(), "..", filename);
}
