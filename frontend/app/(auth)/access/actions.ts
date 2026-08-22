/** Activates the current pending Google identity after server-side invitation verification. */

"use server";

import { redirect } from "next/navigation";
import { getApplicationServices } from "vibe-prompting/server";

import { getCurrentSessionUser } from "@/auth/session";

export async function redeemInvitation(formData: FormData) {
  const user = await getCurrentSessionUser();
  if (!user) redirect("/login");
  if (user.membershipStatus === "active") redirect("/");

  const code = formData.get("invitationCode");
  const services = await getApplicationServices();
  const result = await services.auth.redeemInvitation(
    user.id,
    typeof code === "string" ? code : "",
  );
  if (result === "missing-configuration") redirect("/access?error=configuration");
  if (result === "locked") redirect("/access?error=locked");
  if (result === "invalid") redirect("/access?error=invalid-code");
  redirect("/");
}
