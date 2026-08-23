/** Collects the one-time invitation code for a verified Google identity that is still pending access. */

import { AlertCircle } from "lucide-react";
import { redirect } from "next/navigation";

import { getCurrentSessionUser } from "@/auth/session";
import { AuthShell } from "@/components/auth/auth-shell";
import { AuthSubmitButton } from "@/components/auth/submit-button";
import { Input } from "@/components/ui/input";

import { redeemInvitation } from "./actions";

const errors: Record<string, string> = {
  configuration: "Invitation enrollment is not configured for this deployment.",
  "invalid-code": "That invitation code was not accepted. Check the code and try again.",
  locked: "Too many invitation attempts. Try again in 15 minutes.",
};

export default async function AccessPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string | string[] }>;
}) {
  const user = await getCurrentSessionUser();
  if (!user) redirect("/login");
  if (user.membershipStatus === "active") redirect("/");
  const errorValue = (await searchParams).error;
  const error = typeof errorValue === "string" ? errorValue : undefined;

  return (
    <AuthShell>
      <h1 className="text-base font-medium">Enter Invitation Code</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        Signed in as <span className="font-medium text-foreground">{user.email}</span>
      </p>

      {error ? (
        <div className="mt-6 flex gap-2 border-y py-3 text-sm text-destructive" role="alert">
          <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span>{errors[error] ?? "Activation failed. Try again."}</span>
        </div>
      ) : null}

      <form action={redeemInvitation} className="mt-7 space-y-4">
        <div>
          <label className="mb-2 block text-sm font-medium" htmlFor="invitation-code">
            Invitation Code
          </label>
          <Input
            autoComplete="one-time-code"
            autoFocus
            id="invitation-code"
            name="invitationCode"
            placeholder="Enter your invitation code"
            required
            type="password"
          />
        </div>
        <AuthSubmitButton pendingLabel="Activating account…">Activate account</AuthSubmitButton>
      </form>

      <form action="/api/auth/logout" className="mt-6" method="post">
        <button
          className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          type="submit"
        >
          Sign in with a different Google account
        </button>
      </form>
    </AuthShell>
  );
}
