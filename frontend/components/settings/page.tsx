/** Owns model catalogue editing and masked provider credential replacement for the settings route. */

"use client";

import { Check, CircleAlert, KeyRound, LoaderCircle, Plus, RotateCcw, Trash2 } from "lucide-react";
import { type Dispatch, type SetStateAction, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { ModelIcon, useModelIdentity } from "@/components/chat/model-selector";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { cn } from "@/components/ui/utils";
import type {
  ProviderSettings,
  ProviderSettingsPatch,
  SettingsModel,
  SettingsPlatformId,
  SettingsResponse,
  UpdateSettingsRequest,
} from "@/contracts/settings";
import { createApiRequester, createErrorReader } from "@/shared/api";

const settingsApi = createApiRequester({}, "Request failed.");
const readError = createErrorReader("Unable to load settings.");

const PLATFORM_OPTIONS: Array<{ label: string; value: SettingsPlatformId }> = [
  { label: "CLIProxyAPI", value: "cliproxy" },
  { label: "Gemini API", value: "gemini" },
  { label: "OpenAI-compatible", value: "llm" },
];

type ProviderDraft = {
  apiKey: string;
  baseURL: string;
  clearApiKey: boolean;
};

export function SettingsPage() {
  const [settings, setSettings] = useState<SettingsResponse>();
  const [helperModel, setHelperModel] = useState<SettingsModel>({ id: "", platform: "llm" });
  const [models, setModels] = useState<SettingsModel[]>([]);
  const [providerDrafts, setProviderDrafts] = useState<
    Partial<Record<SettingsPlatformId, ProviderDraft>>
  >({});
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    void fetchSettings()
      .then((loaded) => {
        if (!active) return;
        setSettings(loaded);
        setHelperModel(loaded.helperModel);
        setModels(loaded.models);
        setProviderDrafts(createProviderDrafts(loaded.providers));
      })
      .catch((cause) => active && setError(readError(cause)));
    return () => {
      active = false;
    };
  }, []);

  const dirty = useMemo(() => {
    if (!settings) return false;
    if (JSON.stringify(helperModel) !== JSON.stringify(settings.helperModel)) return true;
    if (JSON.stringify(models) !== JSON.stringify(settings.models)) return true;
    return settings.providers.some((provider) => {
      const draft = providerDrafts[provider.id];
      return Boolean(draft && toProviderPatch(provider, draft));
    });
  }, [helperModel, models, providerDrafts, settings]);
  const canAddModel = Boolean(models.at(-1)?.id.trim());

  const save = async () => {
    if (!settings) return;
    const validationError = validateModels(models, helperModel);
    if (validationError) {
      setError(validationError);
      return;
    }
    setError(undefined);
    setSaving(true);
    try {
      const providers = settings.providers.flatMap((provider): ProviderSettingsPatch[] => {
        const draft = providerDrafts[provider.id];
        const patch = draft && toProviderPatch(provider, draft);
        return patch ? [patch] : [];
      });
      const updated = await settingsApi.json<SettingsResponse>("/api/settings", {
        body: JSON.stringify({ helperModel, models, providers } satisfies UpdateSettingsRequest),
        headers: { "content-type": "application/json" },
        method: "PUT",
      });
      setSettings(updated);
      setHelperModel(updated.helperModel);
      setModels(updated.models);
      setProviderDrafts(createProviderDrafts(updated.providers));
      toast.success("Settings saved");
    } catch (cause) {
      setError(readError(cause));
    } finally {
      setSaving(false);
    }
  };

  if (!settings && !error) {
    return (
      <div className="mx-auto flex min-h-[calc(100dvh-var(--header-height))] max-w-5xl items-center justify-center px-5">
        <LoaderCircle
          aria-label="Loading settings"
          className="size-5 animate-spin text-muted-foreground"
        />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 sm:py-10">
      <div className="max-w-2xl">
        <h2 className="text-xl font-semibold tracking-tight">Models and provider access</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Choose which models appear across chat and evaluations. Saved API keys stay on the server
          and are never shown again.
        </p>
      </div>

      {error ? (
        <div
          className="mt-6 rounded-xl border border-destructive/35 bg-destructive/5 px-4 py-3 text-sm text-destructive"
          role="alert"
        >
          {error}
        </div>
      ) : null}

      {settings ? (
        <>
          <section className="mt-10" aria-labelledby="model-catalog-title">
            <div className="flex items-end justify-between gap-4 border-b pb-3">
              <div>
                <h3 className="text-sm font-semibold" id="model-catalog-title">
                  Model catalogue
                </h3>
              </div>
              <Button
                disabled={!canAddModel}
                onClick={() =>
                  setModels((current) =>
                    current.at(-1)?.id.trim() ? [...current, { id: "", platform: "llm" }] : current,
                  )
                }
                size="sm"
                title={canAddModel ? "Add model" : "Finish the empty model first"}
                variant="outline"
              >
                <Plus aria-hidden="true" className="size-3.5" /> Add model
              </Button>
            </div>
            <div className="divide-y">
              {models.map((model, index) => (
                <ModelRow
                  index={index}
                  key={index}
                  model={model}
                  canRemove={models.length > 1}
                  setModels={setModels}
                />
              ))}
            </div>
          </section>

          <section className="mt-12" aria-labelledby="helper-model-title">
            <div className="border-b pb-3">
              <h3 className="text-sm font-semibold" id="helper-model-title">
                Helper Model
              </h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Handles small background tasks across the app at low reasoning effort.
              </p>
            </div>
            <HelperModelRow model={helperModel} onChange={setHelperModel} />
          </section>

          <section className="mt-12" aria-labelledby="provider-access-title">
            <div className="border-b pb-3">
              <h3 className="text-sm font-semibold" id="provider-access-title">
                Provider access
              </h3>
              <p className="mt-1 text-xs text-muted-foreground">
                BYOK credentials override deployment credentials until removed.
              </p>
            </div>
            <div className="divide-y">
              {settings.providers.map((provider) => (
                <ProviderRow
                  canSaveCredentials={settings.canSaveCredentials}
                  draft={providerDrafts[provider.id] ?? emptyProviderDraft(provider)}
                  key={provider.id}
                  onChange={(draft) =>
                    setProviderDrafts((current) => ({ ...current, [provider.id]: draft }))
                  }
                  provider={provider}
                />
              ))}
            </div>
          </section>

          <div className="mt-10 flex items-center justify-between gap-4 border-t pt-5">
            <p className="text-xs text-muted-foreground">
              Model identities and logos are resolved through{" "}
              <a
                className="font-medium text-foreground underline underline-offset-2"
                href="https://models.dev"
                rel="noreferrer"
                target="_blank"
              >
                Models.dev
              </a>
              .
            </p>
            <Button disabled={!dirty || saving} onClick={save}>
              {saving ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> : null}
              Save changes
            </Button>
          </div>
        </>
      ) : null}
    </div>
  );
}

function HelperModelRow({
  model,
  onChange,
}: {
  model: SettingsModel;
  onChange(model: SettingsModel): void;
}) {
  return (
    <div className="grid gap-3 py-4 sm:grid-cols-[minmax(0,1fr)_13rem] sm:items-center">
      <ModelFields
        connectionLabel="Helper Model connection"
        idLabel="Helper Model ID"
        model={model}
        onChange={onChange}
      />
    </div>
  );
}

function ModelRow({
  index,
  model,
  canRemove,
  setModels,
}: {
  index: number;
  model: SettingsModel;
  canRemove: boolean;
  setModels: Dispatch<SetStateAction<SettingsModel[]>>;
}) {
  return (
    <div className="grid gap-3 py-4 sm:grid-cols-[minmax(0,1fr)_13rem_auto] sm:items-center">
      <ModelFields
        connectionLabel={`Model ${index + 1} connection`}
        idLabel={`Model ${index + 1} ID`}
        model={model}
        onChange={(next) => updateModel(index, next, setModels)}
      />
      <Button
        aria-label={`Remove ${model.id || `model ${index + 1}`}`}
        className="self-end text-muted-foreground hover:text-destructive sm:self-auto"
        disabled={!canRemove}
        onClick={() => removeModel(index, model, setModels)}
        size="icon"
        title="Remove model"
        variant="ghost"
      >
        <Trash2 aria-hidden="true" className="size-4" />
      </Button>
    </div>
  );
}

function ModelFields({
  connectionLabel,
  idLabel,
  model,
  onChange,
}: {
  connectionLabel: string;
  idLabel: string;
  model: SettingsModel;
  onChange(model: SettingsModel): void;
}) {
  const modelId = model.id.trim();
  const debouncedModelId = useDebouncedValue(modelId, 300);
  const identity = useModelIdentity(undefined, debouncedModelId || undefined);
  const pending = Boolean(modelId && (debouncedModelId !== modelId || !identity));

  return (
    <>
      <label className="grid gap-1.5">
        <span className="text-xs font-medium text-muted-foreground">Model ID</span>
        <div className="flex items-center gap-2">
          <ModelIcon model={identity} />
          <div className="relative min-w-0 flex-1">
            <Input
              aria-label={idLabel}
              className="pr-10"
              onChange={(event) => onChange({ ...model, id: event.target.value })}
              placeholder="model-name or provider/model-name"
              value={model.id}
            />
            <ModelIdentityStatus identity={identity} pending={pending} visible={Boolean(modelId)} />
          </div>
        </div>
      </label>
      <label className="grid gap-1.5">
        <span className="text-xs font-medium text-muted-foreground">Connection</span>
        <Select
          aria-label={connectionLabel}
          onChange={(event) =>
            onChange({ ...model, platform: event.target.value as SettingsPlatformId })
          }
          value={model.platform}
        >
          {PLATFORM_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </label>
    </>
  );
}

function ModelIdentityStatus({
  identity,
  pending,
  visible,
}: {
  identity: ReturnType<typeof useModelIdentity>;
  pending: boolean;
  visible: boolean;
}) {
  if (!visible) return null;
  if (pending) {
    return (
      <LoaderCircle
        aria-label="Checking Models.dev"
        className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground"
      />
    );
  }
  if (identity?.known) {
    return (
      <Check
        aria-label="Recognized by Models.dev"
        className="absolute right-3 top-1/2 size-4 -translate-y-1/2 text-emerald-600 dark:text-emerald-400"
      />
    );
  }
  return (
    <CircleAlert
      aria-label="Not found in Models.dev"
      className="absolute right-3 top-1/2 size-4 -translate-y-1/2 text-amber-600 dark:text-amber-400"
    />
  );
}

function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timeout = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timeout);
  }, [delay, value]);
  return debounced;
}

function ProviderRow({
  canSaveCredentials,
  draft,
  onChange,
  provider,
}: {
  canSaveCredentials: boolean;
  draft: ProviderDraft;
  onChange(draft: ProviderDraft): void;
  provider: ProviderSettings;
}) {
  const baseUrlEditable = provider.id !== "gemini";
  return (
    <div className="py-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="grid size-8 place-items-center rounded-lg bg-muted text-muted-foreground">
            <KeyRound aria-hidden="true" className="size-4" />
          </span>
          <div>
            <h4 className="text-sm font-medium">{provider.label}</h4>
            <p className="text-xs text-muted-foreground">{credentialDescription(provider)}</p>
          </div>
        </div>
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[11px] font-medium",
            provider.configured
              ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
              : "bg-muted text-muted-foreground",
          )}
        >
          {provider.configured ? <Check aria-hidden="true" className="size-3" /> : null}
          {provider.configured ? "Configured" : "Not configured"}
        </span>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">API key</span>
          <Input
            autoComplete="off"
            disabled={draft.clearApiKey}
            onChange={(event) =>
              onChange({ ...draft, apiKey: event.target.value, clearApiKey: false })
            }
            placeholder={provider.configured ? "Replace saved key" : "Enter API key"}
            type="password"
            value={draft.apiKey}
          />
        </label>
        <label className="grid gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">Base URL</span>
          <Input
            disabled={!baseUrlEditable}
            onChange={(event) => onChange({ ...draft, baseURL: event.target.value })}
            value={draft.baseURL}
          />
        </label>
      </div>
      <div className="mt-3 flex min-h-8 items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {canSaveCredentials
            ? "The saved value is encrypted and cannot be revealed from this page."
            : "Encrypted credential storage is unavailable on this deployment."}
        </p>
        {provider.credentialSource === "byok" ? (
          <Button
            className={cn(draft.clearApiKey && "text-destructive")}
            onClick={() => onChange({ ...draft, apiKey: "", clearApiKey: !draft.clearApiKey })}
            size="sm"
            variant="ghost"
          >
            <RotateCcw aria-hidden="true" className="size-3.5" />
            {draft.clearApiKey ? "Keep BYOK key" : "Use deployment key"}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function createProviderDrafts(
  providers: ProviderSettings[],
): Partial<Record<SettingsPlatformId, ProviderDraft>> {
  return Object.fromEntries(
    providers.map((provider) => [provider.id, emptyProviderDraft(provider)]),
  );
}

function emptyProviderDraft(provider: ProviderSettings): ProviderDraft {
  return { apiKey: "", baseURL: provider.baseURL, clearApiKey: false };
}

function toProviderPatch(
  provider: ProviderSettings,
  draft: ProviderDraft,
): ProviderSettingsPatch | undefined {
  const apiKey = draft.apiKey.trim();
  const baseURL = draft.baseURL.trim();
  const baseURLChanged = baseURL !== provider.baseURL;
  if (!apiKey && !draft.clearApiKey && !baseURLChanged) return undefined;
  return {
    ...(apiKey ? { apiKey } : {}),
    ...(baseURLChanged ? { baseURL } : {}),
    ...(draft.clearApiKey ? { clearApiKey: true } : {}),
    id: provider.id,
  };
}

function updateModel(
  index: number,
  patch: Partial<SettingsModel>,
  setModels: Dispatch<SetStateAction<SettingsModel[]>>,
) {
  setModels((current) =>
    current.map((model, item) => (item === index ? { ...model, ...patch } : model)),
  );
}

function removeModel(
  index: number,
  model: SettingsModel,
  setModels: Dispatch<SetStateAction<SettingsModel[]>>,
) {
  const label = model.id.trim() || `model ${index + 1}`;
  if (!window.confirm(`Remove ${label}? This takes effect when you save settings.`)) return;
  setModels((current) => current.filter((_, item) => item !== index));
}

function validateModels(models: SettingsModel[], helperModel: SettingsModel): string | undefined {
  if (!helperModel.id.trim()) return "The Helper Model needs a model ID.";
  if (!models.length) return "Add at least one model.";
  const normalized = models.map(({ id }) => id.trim());
  if (normalized.some((id) => !id)) return "Every model needs an ID.";
  if (new Set(normalized).size !== normalized.length) return "Each model ID must be unique.";
}

function credentialDescription(provider: ProviderSettings): string {
  if (provider.credentialSource === "byok") return "Using your encrypted BYOK credential";
  if (provider.credentialSource === "deployment") return "Using the deployment credential";
  return "No credential available";
}

async function fetchSettings(): Promise<SettingsResponse> {
  return settingsApi.json<SettingsResponse>("/api/settings");
}
