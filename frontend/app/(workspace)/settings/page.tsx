/** Presents model catalogue and bring-your-own-key controls inside the shared workspace shell. */

import { Settings } from "lucide-react";

import { SettingsPage } from "@/components/settings/settings-page";
import { FeaturePageHeader } from "@/components/shell/header";

export default function SettingsRoute() {
  return (
    <main className="min-h-screen">
      <FeaturePageHeader icon={Settings} title="Settings" />
      <SettingsPage />
    </main>
  );
}
