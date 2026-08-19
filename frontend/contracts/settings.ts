/** Defines the browser-safe settings contract without exposing stored provider credentials. */

export type SettingsPlatformId = "cliproxy" | "gemini" | "llm";

export type SettingsModel = {
  id: string;
  platform: SettingsPlatformId;
};

export type ProviderSettings = {
  baseURL: string;
  configured: boolean;
  credentialSource: "byok" | "deployment" | "missing";
  id: SettingsPlatformId;
  label: string;
};

export type SettingsResponse = {
  canSaveCredentials: boolean;
  models: SettingsModel[];
  modelStorage: "database" | "yaml";
  providers: ProviderSettings[];
};

export type ProviderSettingsPatch = {
  apiKey?: string;
  baseURL?: string;
  clearApiKey?: boolean;
  id: SettingsPlatformId;
};

export type UpdateSettingsRequest = {
  models: SettingsModel[];
  providers: ProviderSettingsPatch[];
};
