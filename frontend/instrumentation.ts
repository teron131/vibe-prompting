/** Connects the Node host's shutdown signals to the backend runtime without initializing application services during instrumentation. */

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { closeApplicationServices, registerShutdown } = await import("vibe-prompting/server");
  if (process.env.NEXT_MANUAL_SIG_HANDLE) registerShutdown(closeApplicationServices, true);
}
