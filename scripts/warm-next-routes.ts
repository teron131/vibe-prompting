/** Discovers and precompiles local Next API route entries after the development server becomes reachable. */

import { readdir } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { setTimeout as wait } from "node:timers/promises";

const FRONTEND_ORIGIN = process.env.DEV_FRONTEND_ORIGIN ?? "http://localhost:8001";
const ROUTE_ROOT = resolve("frontend/app/api");
const WARM_HEADER = "x-vibe-dev-warm";
const WARM_BATCH_SIZE = 3;
const SERVER_WAIT_MS = 120_000;

await warmNextRoutes();

async function warmNextRoutes(): Promise<void> {
  if (!(await waitForFrontend())) {
    console.warn("Frontend did not become ready; skipping API route warm-up.");
    return;
  }

  const routes = (await findRouteFiles(ROUTE_ROOT))
    .map(routePath)
    .filter((path) => !path.startsWith("/api/auth/") && !path.startsWith("/api/provider-icons/"))
    .sort();
  const startedAt = performance.now();
  for (let index = 0; index < routes.length; index += WARM_BATCH_SIZE) {
    await Promise.all(routes.slice(index, index + WARM_BATCH_SIZE).map(warmRoute));
  }
  console.log(
    `Precompiled ${routes.length} API routes in ${Math.round(performance.now() - startedAt)}ms.`,
  );
}

async function waitForFrontend(): Promise<boolean> {
  const deadline = Date.now() + SERVER_WAIT_MS;
  while (Date.now() < deadline) {
    try {
      await fetch(`${FRONTEND_ORIGIN}/api/health`, { signal: AbortSignal.timeout(2_000) });
      return true;
    } catch {
      await wait(250);
    }
  }
  return false;
}

async function warmRoute(path: string): Promise<void> {
  try {
    await fetch(`${FRONTEND_ORIGIN}${path}`, {
      headers: { [WARM_HEADER]: "1" },
      method: "OPTIONS",
      redirect: "manual",
      signal: AbortSignal.timeout(120_000),
    });
  } catch (error) {
    console.warn(`Could not precompile ${path}.`, error);
  }
}

async function findRouteFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) => {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) return findRouteFiles(path);
      return entry.isFile() && entry.name === "route.ts" ? [path] : [];
    }),
  );
  return files.flat();
}

function routePath(file: string): string {
  const segments = relative(ROUTE_ROOT, file).split(sep).slice(0, -1);
  return `/api/${segments.map((segment) => (segment.startsWith("[") ? "warm" : segment)).join("/")}`;
}
