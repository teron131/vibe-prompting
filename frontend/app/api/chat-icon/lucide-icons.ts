/** Validates Lucide names and renders selected icons at the server boundary. */

import "server-only";
import dynamicIconImports from "lucide-react/dynamicIconImports.js";

export const DEFAULT_CHAT_ICON = "message-circle";

type LucideIconName = keyof typeof dynamicIconImports;
type IconNode = [tag: string, attributes: Record<string, string>][];
type LucideComponent = {
  render: (
    props: Record<string, never>,
    ref: null,
  ) => {
    props: { iconNode: IconNode };
  };
};

/** Pick the first model suggestion shipped by this Lucide version. */
export function resolveLucideIconCandidates(values: readonly string[]): LucideIconName {
  for (const value of values) {
    const candidate = normalizeLucideIconName(value);
    if (candidate in dynamicIconImports) {
      return candidate as LucideIconName;
    }
  }

  return DEFAULT_CHAT_ICON;
}

/** Normalize one stored name and fall back when it is not shipped by this Lucide version. */
export function resolveLucideIconName(value: string): LucideIconName {
  return resolveLucideIconCandidates([value]);
}

function normalizeLucideIconName(value: string) {
  const candidate = value
    .trim()
    .toLowerCase()
    .replace(/^lucide-/, "")
    .replace(/[\s_]+/g, "-");

  return candidate;
}

/** Render one validated icon as a mask-ready SVG without exposing the icon catalog to clients. */
export async function renderLucideIcon(name: string) {
  const iconName = resolveLucideIconName(name);
  const { default: Icon } = await dynamicIconImports[iconName]();
  const { iconNode } = (Icon as unknown as LucideComponent).render({}, null).props;
  const children = iconNode
    .map(([tag, attributes]) => {
      const serializedAttributes = Object.entries(attributes)
        .filter(([attribute]) => attribute !== "key")
        .map(([attribute, value]) => `${attribute}="${escapeXml(value)}"`)
        .join(" ");
      return `<${tag}${serializedAttributes ? ` ${serializedAttributes}` : ""}/>`;
    })
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${children}</svg>`;
}

function escapeXml(value: string) {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&apos;",
    };
    return entities[character] ?? character;
  });
}
