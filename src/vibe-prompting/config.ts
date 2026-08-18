/** Loads the private model catalogue and environment-owned provider credentials for backend clients. */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { config as loadDotenv } from "dotenv";
import { parse } from "yaml";
import { z } from "zod";

export const CONFIG_PATH = ".config.yaml";
export const DEFAULT_CLIPROXYAPI_BASE_URL = "http://localhost:8317/v1";
export const EXA_MCP_URL = "https://mcp.exa.ai/mcp";
export const GEMINI_OPENAI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/";

loadDotenv({ override: false, path: resolveRuntimeFile(".env"), quiet: true });

const platformIds = ["cliproxy", "gemini", "llm"] as const;

export type PlatformId = (typeof platformIds)[number];

export type PlatformConfig = {
  apiKey: string | undefined;
  baseURL: string;
  id: PlatformId;
  label: string;
};

export type ConfiguredPlatform = PlatformConfig & { apiKey: string };

const modelConfigSchema = z.object({
  id: z.string().trim().min(1),
  inputPricePerMillionTokens: z.number().finite().nonnegative(),
  outputPricePerMillionTokens: z.number().finite().nonnegative(),
  platform: z.enum(platformIds),
});

const fileConfigSchema = z
  .object({
    embeddingModel: modelConfigSchema,
    metadataModel: modelConfigSchema,
    models: z.array(modelConfigSchema).min(1),
  })
  .superRefine(({ models }, context) => {
    const seen = new Set<string>();
    for (const [index, model] of models.entries()) {
      if (seen.has(model.id)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate model ID: ${model.id}.`,
          path: ["models", index, "id"],
        });
      }
      seen.add(model.id);
    }
  });

export type ModelConfig = z.infer<typeof modelConfigSchema>;

export type RuntimeConfig = {
  embeddingModel: ModelConfig;
  exa: {
    apiKey: string | undefined;
  };
  metadataModel: ModelConfig;
  models: ModelConfig[];
  platforms: Record<PlatformId, PlatformConfig>;
};

const optionalText = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().trim().min(1).optional(),
);

const environmentSchema = z.object({
  CLIPROXYAPI_API_KEY: optionalText,
  CLIPROXYAPI_BASE_URL: optionalText,
  EXA_API_KEY: optionalText,
  GEMINI_API_KEY: optionalText,
  GOOGLE_API_KEY: optionalText,
  LLM_API_KEY: optionalText,
  LLM_BASE_URL: optionalText,
  MODEL_CONFIG_YAML: optionalText,
});

/** Reads user-editable models separately from provider secrets and endpoints. */
export function loadRuntimeConfig(
  environment: NodeJS.ProcessEnv = process.env,
  configPath: string = resolveRuntimeFile(CONFIG_PATH),
): RuntimeConfig {
  const values = environmentSchema.parse(environment);
  const fileConfig = loadFileConfig(configPath, values.MODEL_CONFIG_YAML);
  const geminiApiKey = values.GEMINI_API_KEY ?? values.GOOGLE_API_KEY;

  return {
    embeddingModel: fileConfig.embeddingModel,
    exa: {
      apiKey: values.EXA_API_KEY,
    },
    metadataModel: fileConfig.metadataModel,
    models: fileConfig.models,
    platforms: {
      cliproxy: {
        apiKey: values.CLIPROXYAPI_API_KEY,
        baseURL: parseHttpUrl(
          values.CLIPROXYAPI_BASE_URL ?? DEFAULT_CLIPROXYAPI_BASE_URL,
          "CLIPROXYAPI_BASE_URL",
        ),
        id: "cliproxy",
        label: "CLIProxyAPI",
      },
      gemini: {
        apiKey: geminiApiKey,
        baseURL: GEMINI_OPENAI_BASE_URL,
        id: "gemini",
        label: "Gemini API",
      },
      llm: {
        apiKey: values.LLM_API_KEY,
        baseURL: values.LLM_BASE_URL ? parseHttpUrl(values.LLM_BASE_URL, "LLM_BASE_URL") : "",
        id: "llm",
        label: "LLM API",
      },
    },
  };
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
