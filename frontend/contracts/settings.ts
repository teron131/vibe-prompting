/** Defines the browser-safe settings contract without exposing stored provider credentials. */

export type SettingsPlatformId = "cliproxy" | "gemini" | "llm";

export type SettingsModel = {
  id: string;
  platform: SettingsPlatformId;
};

export type ProviderSettings = {
  id: SettingsPlatformId;
  label: string;
  baseURL: string;
  configured: boolean;
  credentialSource: "byok" | "deployment" | "missing";
};

export type SettingsResponse = {
  revision: number;
  models: SettingsModel[];
  helperModel: SettingsModel;
  providers: ProviderSettings[];
  canSaveCredentials: boolean;
};

export type ProviderSettingsPatch = {
  id: SettingsPlatformId;
  baseURL?: string;
  apiKey?: string;
  clearApiKey?: boolean;
};

export type UpdateSettingsRequest = {
  expectedRevision: number;
  models: SettingsModel[];
  helperModel: SettingsModel;
  providers: ProviderSettingsPatch[];
};
