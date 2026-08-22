/** Presents model catalogue and bring-your-own-key controls inside the shared workspace shell. */

import { Settings } from "lucide-react";

import { SettingsEditor } from "@/components/settings/editor";
import { FeaturePageHeader } from "@/components/shell/header";
import { WorkspaceHomeLink } from "@/components/shell/home-link";

export default function SettingsRoute() {
  return (
    <main className="min-h-dvh">
      <FeaturePageHeader
        icon={Settings}
        rightContent={<WorkspaceHomeLink />}
        scope="Shared"
        title="Settings"
      />
      <SettingsEditor />
    </main>
  );
}
