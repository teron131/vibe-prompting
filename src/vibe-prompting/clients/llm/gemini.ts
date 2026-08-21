/** Reads provider-native Gemini continuation metadata without depending on an agent framework. */

export function readGeminiThoughtSignature(
  additionalKwargs: Record<string, unknown>,
  toolCallId: string,
): string | undefined {
  const rawToolCalls = additionalKwargs["tool_calls"];
  if (!Array.isArray(rawToolCalls)) return undefined;

  const rawToolCall: unknown = rawToolCalls.find(
    (candidate) => isRecord(candidate) && candidate.id === toolCallId,
  );
  if (!isRecord(rawToolCall)) return undefined;
  return readGeminiThoughtSignatureFromExtraContent(rawToolCall.extra_content);
}

export function readGeminiThoughtSignatureFromExtraContent(
  extraContent: unknown,
): string | undefined {
  if (!isRecord(extraContent)) return undefined;
  const google = extraContent.google;
  if (!isRecord(google)) return undefined;
  const thoughtSignature = google.thought_signature;
  return typeof thoughtSignature === "string" && thoughtSignature ? thoughtSignature : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
