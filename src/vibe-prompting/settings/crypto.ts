/** Encrypts provider credentials for database persistence without exposing reusable plaintext or raw key material. */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

import { z } from "zod";

const encryptedSecretSchema = z.object({
  version: z.literal(1),
  iv: z.string().min(1),
  ciphertext: z.string().min(1),
  tag: z.string().min(1),
});

export type EncryptedSecret = z.infer<typeof encryptedSecretSchema>;

export function parseEncryptedSecret(value: unknown): EncryptedSecret {
  return encryptedSecretSchema.parse(value);
}

export function encryptSecret(value: string, secret: string): EncryptedSecret {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(secret), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return {
    version: 1,
    iv: iv.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  };
}

export function decryptSecret(value: EncryptedSecret, secret: string): string {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    deriveKey(secret),
    Buffer.from(value.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(value.tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(value.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

function deriveKey(secret: string): Buffer {
  return createHash("sha256").update(secret, "utf8").digest();
}
