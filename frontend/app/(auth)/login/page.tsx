/** Offers Google sign-in and routes known sessions directly to their current access state. */

import { AlertCircle } from "lucide-react";
import { redirect } from "next/navigation";

import { safeReturnPath } from "@/auth/google";
import { getCurrentSessionUser } from "@/auth/session";
import { AuthShell } from "@/components/auth/auth-shell";
import { GoogleMark } from "@/components/auth/google-mark";
import { AuthSubmitButton } from "@/components/auth/submit-button";

const errors: Record<string, string> = {
  "oauth-failed": "Google sign-in could not be completed. Try again.",
  "oauth-state": "The sign-in request expired. Start again from this page.",
  "oauth-unavailable": "Google sign-in is not configured for this deployment.",
  "unverified-email": "This Google account does not provide a verified email address.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string | string[]; returnTo?: string | string[] }>;
}) {
  const params = await searchParams;
  const returnPath = safeReturnPath(singleValue(params.returnTo));
  const user = await getCurrentSessionUser();
  if (user?.membershipStatus === "active") redirect(returnPath);
  if (user) redirect("/access");
  const error = singleValue(params.error);

  return (
    <AuthShell>
      <h1 className="text-base font-medium">Sign In</h1>

      {error ? (
        <div className="mt-6 flex gap-2 border-y py-3 text-sm text-destructive" role="alert">
          <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span>{errors[error] ?? "Sign-in failed. Try again."}</span>
        </div>
      ) : null}

      <form action="/api/auth/google" className="mt-7" method="get">
        <input name="returnTo" type="hidden" value={returnPath} />
        <AuthSubmitButton pendingLabel="Opening Google…">
          <GoogleMark />
          Continue with Google
        </AuthSubmitButton>
      </form>

      <p className="mt-4 text-xs leading-5 text-muted-foreground">
        Invitation codes are entered after Google verifies your account.
      </p>
    </AuthShell>
  );
}

function singleValue(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}
