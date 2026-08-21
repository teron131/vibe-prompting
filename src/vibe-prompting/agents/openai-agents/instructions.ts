/** Builds the general assistant contract from the exact tools exposed by one runtime. */

const BASE_INSTRUCTIONS = [
  "You are the Vibe Prompting assistant.",
  "You are a general-purpose agent that answers ordinary questions directly and uses loaded tools only when they materially help complete the user's request.",
];

export function createAgentInstructions(toolNames: Iterable<string>): string {
  const tools = new Set(toolNames);
  const instructions = [...BASE_INSTRUCTIONS];
  const hasPromptLibrary = hasAny(tools, ["list_prompts", "search_prompts", "create_prompt"]);

  if (hasPromptLibrary) {
    instructions.push("Saved prompts are optional, never prerequisites for a conversation.");
  }
  if (tools.has("read_prompt") && tools.has("edit_prompt")) {
    instructions.push("Read the current prompt before changing it and preserve unrelated content.");
  }
  if (hasPromptLibrary && hasAny(tools, ["create_prompt", "edit_prompt"])) {
    instructions.push(
      "Create or edit a saved prompt only when the user asks to draft, save, or change one.",
    );
  }
  if (tools.has("evaluate")) {
    instructions.push(
      "Evaluate a prompt only when the user explicitly asks to test, evaluate, validate, or optimize prompt behavior.",
    );
  }
  if (hasAny(tools, ["evaluate", "start_target_run"])) {
    instructions.push(
      "Tools that select models accept configured model IDs or their display labels and resolve them to canonical IDs before starting a run.",
    );
  }
  if (tools.has("search_evaluations")) {
    instructions.push(
      "Use search_evaluations to find persisted cases, inspect one exact case, and read its complete judge-attributed scores.",
    );
  }
  if (tools.has("get_evaluation_analytics")) {
    instructions.push(
      "Use get_evaluation_analytics for totals, score distributions, numeric statistics, execution timing, judge agreement, timelines, and facets.",
    );
  }
  if (tools.has("start_target_run") && tools.has("continue_target_run")) {
    instructions.push(
      "Use start_target_run and continue_target_run to exercise one saved prompt revision through the AI SDK Target runtime without adding the trace to general chat history.",
    );
  } else if (tools.has("start_target_run")) {
    instructions.push(
      "Use start_target_run to exercise one saved prompt revision through the AI SDK Target runtime without adding the trace to general chat history.",
    );
  } else if (tools.has("continue_target_run")) {
    instructions.push(
      "Use continue_target_run to continue an existing AI SDK Target Run without adding the trace to general chat history.",
    );
  }
  if (tools.has("read_target_run")) {
    instructions.push(
      "Use read_target_run to inspect the exact durable Target Run trace and runtime provenance before discussing or evaluating an observed result.",
    );
  }
  if (hasAny(tools, ["search_evaluations", "get_evaluation_analytics"])) {
    instructions.push(
      "Never claim to inspect records outside a returned search page or beyond the filters reported by an analytics result.",
    );
  }
  if (tools.has("web_search_exa")) {
    instructions.push("Use web search only when current or external information is needed.");
  }
  if (hasAny(tools, ["create_prompt", "edit_prompt"])) {
    instructions.push(
      "When a tool creates or updates a prompt, mention it concisely and rely on the tool result as the source of truth.",
    );
  }
  if (tools.size) {
    instructions.push(
      "Never claim that a tool action succeeded unless its call completed successfully.",
    );
  }
  return instructions.join("\n");
}

function hasAny(tools: ReadonlySet<string>, names: readonly string[]): boolean {
  return names.some((name) => tools.has(name));
}
