/** Owns constant-time validation of the deployment invitation secret. */

import { createHash, timingSafeEqual } from "node:crypto";

type InvitationCodeResult = "invalid" | "missing-configuration" | "valid";

export function validateInvitationCode(value: string): InvitationCodeResult {
  const expected = process.env.INVITATION_CODE;
  if (!expected) return "missing-configuration";
  const expectedDigest = createHash("sha256").update(expected, "utf8").digest();
  const suppliedDigest = createHash("sha256").update(value, "utf8").digest();
  return timingSafeEqual(expectedDigest, suppliedDigest) ? "valid" : "invalid";
}
