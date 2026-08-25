/** Owns provider-icon cache resolution and Artificial Analysis discovery for server routes. */

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, sep } from "node:path";

const ARTIFICIAL_ANALYSIS_ORIGIN = "https://artificialanalysis.ai";
const ARTIFICIAL_ANALYSIS_MODELS_URL = `${ARTIFICIAL_ANALYSIS_ORIGIN}/leaderboards/models`;
const CACHE_MS = 24 * 60 * 60 * 1000;
const LEADERBOARD_ROW_KEY = "intelligenceIndex";
const MODEL_SEARCH_BACKTRACK_CHARS = 20_000;
const NEXT_FLIGHT_CHUNK_REGEX = /self\.__next_f\.push\(\[1,"([\s\S]*?)"\]\)<\/script>/g;

type JsonRecord = Record<string, unknown>;
type ProviderIcon = { body: ArrayBuffer; contentType: string };

let bundledIconFilesPromise: Promise<string[]> | undefined;
let providerLogoSources: { expiresAt: number; sources: Map<string, string> } | undefined;
let providerLogoSourcesPromise: Promise<Map<string, string>> | undefined;
const pendingProviderIcons = new Map<string, Promise<ProviderIcon | undefined>>();

/** Read a provider icon from local caches or discover and cache it on demand. */
export async function resolveProviderIcon(value: string): Promise<ProviderIcon | undefined> {
  const provider = providerSlug(value);
  if (!provider) return undefined;

  const bundled = await readBundledProviderIcon(provider);
  if (bundled) return bundled;

  const cached = await readIconFile(resolve(providerIconCacheDirectory(), `${provider}.svg`));
  if (cached) return cached;

  const pending = pendingProviderIcons.get(provider);
  if (pending) return pending;
  const request = discoverProviderIcon(provider)
    .catch(() => undefined)
    .finally(() => {
      pendingProviderIcons.delete(provider);
    });
  pendingProviderIcons.set(provider, request);
  return request;
}

async function readBundledProviderIcon(provider: string): Promise<ProviderIcon | undefined> {
  const directory = bundledIconDirectory();
  bundledIconFilesPromise ??= readdir(directory).catch(() => []);
  const providerKey = comparableProviderKey(provider);
  const filename = (await bundledIconFilesPromise).find(
    (candidate) => comparableProviderKey(candidate.replace(/\.[^.]+$/, "")) === providerKey,
  );
  if (!filename) return undefined;
  return readIconFile(resolve(directory, filename));
}

async function discoverProviderIcon(provider: string): Promise<ProviderIcon | undefined> {
  const source = (await loadProviderLogoSources()).get(comparableProviderKey(provider));
  if (!source) return undefined;

  const response = await fetch(source, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) return undefined;
  const bytes = Buffer.from(await response.arrayBuffer());
  const contentType = imageContentType(response.headers.get("content-type"), source);
  if (bytes.length === 0 || !contentType) return undefined;

  const iconBytes = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><image href="data:${contentType};base64,${bytes.toString("base64")}" width="64" height="64" preserveAspectRatio="xMidYMid meet"/></svg>`,
  );
  const cacheDirectory = providerIconCacheDirectory();
  await mkdir(cacheDirectory, { recursive: true })
    .then(() => writeFile(resolve(cacheDirectory, `${provider}.svg`), iconBytes))
    .catch(() => undefined);
  return { body: copyArrayBuffer(iconBytes), contentType: "image/svg+xml" };
}

async function loadProviderLogoSources(): Promise<Map<string, string>> {
  if (providerLogoSources && providerLogoSources.expiresAt > Date.now()) {
    return providerLogoSources.sources;
  }
  providerLogoSourcesPromise ??= fetch(ARTIFICIAL_ANALYSIS_MODELS_URL, {
    signal: AbortSignal.timeout(30_000),
  })
    .then(async (response) => {
      if (!response.ok) {
        throw new Error(`Artificial Analysis returned HTTP ${response.status}.`);
      }
      const sources = extractProviderLogos(await response.text());
      if (sources.size === 0) throw new Error("Artificial Analysis returned no provider logos.");
      return sources;
    })
    .then((sources) => {
      providerLogoSources = { expiresAt: Date.now() + CACHE_MS, sources };
      return sources;
    })
    .catch(() => new Map<string, string>())
    .finally(() => {
      providerLogoSourcesPromise = undefined;
    });
  return providerLogoSourcesPromise;
}

function extractProviderLogos(pageHtml: string): Map<string, string> {
  const providers = new Map<string, string>();
  for (const row of extractLeaderboardRows(extractNextFlightCorpus(pageHtml))) {
    const creator = asRecord(row.creator);
    const modelCreators = asRecord(row.model_creators);
    const provider = providerSlug(
      firstString(row, ["modelCreatorSlug", "modelCreatorName"]) ??
        firstString(creator, ["slug", "name"]) ??
        firstString(modelCreators, ["slug", "name"]),
    );
    const logo = absoluteLogoUrl(
      firstString(row, [
        "modelCreatorLogo",
        "logo_small_url",
        "logo_url",
        "logoSmall",
        "logo_small",
      ]) ??
        firstString(creator, ["logo_small_url", "logo_url", "logo_small", "logo"]) ??
        firstString(modelCreators, ["logo_small_url", "logo_url", "logo_small", "logo"]),
    );
    if (!provider || !logo) continue;
    const providerKey = comparableProviderKey(provider);
    if (!providers.has(providerKey)) providers.set(providerKey, logo);
  }
  return providers;
}

function extractNextFlightCorpus(pageHtml: string): string {
  return [...pageHtml.matchAll(NEXT_FLIGHT_CHUNK_REGEX)]
    .map((match) => decodeFlightChunk(match[1] ?? ""))
    .join("\n");
}

function decodeFlightChunk(raw: string): string {
  try {
    return JSON.parse(`"${raw}"`) as string;
  } catch {
    return raw;
  }
}

function extractLeaderboardRows(flightCorpus: string): JsonRecord[] {
  const rows = new Map<string, JsonRecord>();
  let cursor = 0;
  while (true) {
    const hitIndex = flightCorpus.indexOf(`"${LEADERBOARD_ROW_KEY}":`, cursor);
    if (hitIndex === -1) break;
    cursor = hitIndex + 1;
    const searchStart = Math.max(0, hitIndex - MODEL_SEARCH_BACKTRACK_CHARS);

    for (let startIndex = hitIndex; startIndex >= searchStart; startIndex -= 1) {
      if (flightCorpus[startIndex] !== "{") continue;
      const endIndex = findObjectEnd(flightCorpus, startIndex);
      if (endIndex < hitIndex) continue;
      const row = parseJsonRecord(flightCorpus.slice(startIndex, endIndex + 1));
      if (!row || !(LEADERBOARD_ROW_KEY in row)) continue;
      const rowId = firstString(row, ["id", "model_id", "slug"]);
      if (!rowId) continue;
      rows.set(rowId, row);
      break;
    }
  }
  return [...rows.values()];
}

function findObjectEnd(value: string, startIndex: number): number {
  let depth = 0;
  let inString = false;
  let escaping = false;
  for (let index = startIndex; index < value.length; index += 1) {
    const character = value[index];
    if (inString) {
      if (escaping) escaping = false;
      else if (character === "\\") escaping = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === "{") depth += 1;
    else if (character === "}" && --depth === 0) return index;
  }
  return -1;
}

function parseJsonRecord(value: string): JsonRecord | undefined {
  try {
    return asRecord(JSON.parse(value));
  } catch {
    return undefined;
  }
}

function asRecord(value: unknown): JsonRecord {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function firstString(record: JsonRecord, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return undefined;
}

function absoluteLogoUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith("/")) return `${ARTIFICIAL_ANALYSIS_ORIGIN}${value}`;
  if (value.includes("/")) return `${ARTIFICIAL_ANALYSIS_ORIGIN}/${value}`;
  return `${ARTIFICIAL_ANALYSIS_ORIGIN}/img/logos/${value}`;
}

function imageContentType(value: string | null, source: string): string | undefined {
  const contentType = value?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType?.startsWith("image/")) return contentType;
  if (/\.svg(?:$|\?)/i.test(source)) return "image/svg+xml";
  if (/\.png(?:$|\?)/i.test(source)) return "image/png";
  if (/\.jpe?g(?:$|\?)/i.test(source)) return "image/jpeg";
  if (/\.webp(?:$|\?)/i.test(source)) return "image/webp";
  return undefined;
}

async function readIconFile(path: string): Promise<ProviderIcon | undefined> {
  const bytes = await readFile(path).catch(() => undefined);
  return bytes
    ? { body: copyArrayBuffer(bytes), contentType: contentTypeForFilename(path) }
    : undefined;
}

function copyArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function bundledIconDirectory(): string {
  const workingDirectory = process.cwd();
  const frontendDirectory = workingDirectory.endsWith(`${sep}frontend`)
    ? workingDirectory
    : resolve(workingDirectory, "frontend");
  return resolve(frontendDirectory, "public/provider-icons");
}

function providerIconCacheDirectory(): string {
  return process.env.VERCEL === "1"
    ? resolve(tmpdir(), "vibe-prompting/provider-icons")
    : resolve(".cache/provider-icons");
}

function comparableProviderKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function contentTypeForFilename(filename: string): string {
  if (filename.toLowerCase().endsWith(".png")) return "image/png";
  if (/\.jpe?g$/i.test(filename)) return "image/jpeg";
  return "image/svg+xml";
}

function providerSlug(value: string | undefined): string | undefined {
  const slug = value
    ?.trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || undefined;
}
