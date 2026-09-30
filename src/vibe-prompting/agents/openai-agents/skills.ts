/** Binds the SDK's native skill discovery to a local read-only workspace so saved instructions cannot execute commands on the application host. */

import { posix } from "node:path";

import { type SandboxRunConfig, type SkillDescriptor } from "@openai/agents/sandbox";
import { UnixLocalSandboxClient } from "@openai/agents/sandbox/local";

import type { StoredSkill } from "../../context-system/index.ts";

export const SKILL_WORKSPACE_INSTRUCTIONS =
  "You have a read-only skill workspace. Read a skill's full SKILL.md using exec_command with cat followed by its listed path. Only cat of the supplied skill files is supported; commands, scripts, host files, and workspace writes are unavailable. Use application tools for application operations.";

/** Converts pinned application records to SDK descriptors while keeping duplicate names usable through stable record-specific workspace paths. */
export function toSkillDescriptors(records: StoredSkill[]): SkillDescriptor[] {
  const names = new Map<string, number>();
  for (const record of records)
    names.set(record.skill.name, (names.get(record.skill.name) ?? 0) + 1);
  return records.map((record) => ({
    name:
      names.get(record.skill.name)! > 1 ? `${record.skill.name}-${record.id}` : record.skill.name,
    description: record.skill.description,
    content: record.markdown,
  }));
}

/** Lets the SDK create and clean up each workspace while restricting its shell entry point to reading the pinned skill files. */
export function skillSandbox(): SandboxRunConfig {
  return { client: new ReadOnlySkillClient() };
}

class ReadOnlySkillClient extends UnixLocalSandboxClient {
  // Every call reconstructs its files from pinned DB revisions; no workspace snapshot should survive a run.
  canPersistOwnedSessionState(): boolean {
    return false;
  }

  async create(...args: Parameters<UnixLocalSandboxClient["create"]>) {
    const session = await super.create(...args);
    const allowed = new Set(
      Object.keys(session.state.manifest.entries).map((path) => `${path}/SKILL.md`),
    );
    session.supportsPty = () => false;
    session.execCommand = async ({ cmd, workdir }) => {
      const match = /^\s*cat\s+(?:--\s+)?(?:"([^"\n]+)"|'([^'\n]+)'|([^\s]+))\s*$/.exec(cmd);
      if (!match) return "Only cat <skill-path>/SKILL.md is supported in this read-only workspace.";
      const requested = match[1] ?? match[2] ?? match[3]!;
      const path = posix.resolve(workdir ?? session.state.manifest.root, requested);
      const relative = posix.relative(session.state.manifest.root, path);
      if (!allowed.has(relative)) return "This path is not a skill file supplied to this run.";
      const content = await session.readFile({ path: relative });
      return new TextDecoder().decode(content);
    };
    return session;
  }
}
