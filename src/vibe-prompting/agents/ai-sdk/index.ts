/** Publishes Vercel AI SDK model and runtime integration without Target-domain coupling. */

export { createModel as createAiSdkModel } from "./model.ts";
export { createAiSdkAgent, type AiSdkAgentOptions } from "./runtime.ts";
