/** Owns Google identities, invitation activation, and revocable opaque application sessions. */

import { createHash, randomBytes, randomUUID } from "node:crypto";

import type { Database } from "../database/index.ts";
import { validateInvitationCode } from "./invitation.ts";

const INVITATION_LOCK_MINUTES = 15;
const MAX_INVITATION_ATTEMPTS = 5;

export type MembershipStatus = "active" | "pending";

export type SessionUser = {
  id: string;
  email: string;
  name: string | null;
  membershipStatus: MembershipStatus;
};

type InvitationStateRow = {
  membershipStatus: MembershipStatus;
  invitationAttemptCount: number;
  invitationLockedUntil: Date | null;
};

export type InvitationRedemption = "active" | "invalid" | "locked" | "missing-configuration";

class ActiveUserRequiredError extends Error {
  readonly statusCode = 403;

  constructor() {
    super("Active application membership is required.");
    this.name = "ActiveUserRequiredError";
  }
}

export class AuthService {
  readonly #database: Database;

  constructor(database: Database) {
    this.#database = database;
  }

  async upsertGoogleUser(input: {
    googleSubject: string;
    email: string;
    name?: string;
  }): Promise<SessionUser> {
    return this.#database.run(async (sql) => {
      const [user] = await sql<SessionUser[]>`
        INSERT INTO auth_users (id, google_subject, email, name)
        VALUES (
          ${randomUUID()},
          ${input.googleSubject},
          ${input.email},
          ${input.name ?? null}
        )
        ON CONFLICT (google_subject) DO UPDATE SET
          email = EXCLUDED.email,
          name = EXCLUDED.name,
          last_signed_in_at = now()
        RETURNING id, email, name, membership_status
      `;
      if (!user) throw new Error("Google identity could not be stored.");
      return user;
    });
  }

  async createSession(userId: string, expiresAt: Date): Promise<string> {
    const token = randomBytes(32).toString("base64url");
    await this.#database.transaction(async (sql) => {
      await sql`DELETE FROM auth_sessions WHERE expires_at <= now()`;
      await sql`
        INSERT INTO auth_sessions (token_hash, user_id, expires_at)
        VALUES (${hashSessionToken(token)}, ${userId}, ${expiresAt})
      `;
    });
    return token;
  }

  async getSessionUser(token: string): Promise<SessionUser | null> {
    if (!token) return null;
    return this.#database.run(async (sql) => {
      const [user] = await sql<SessionUser[]>`
        SELECT
          auth_users.id,
          auth_users.email,
          auth_users.name,
          auth_users.membership_status
        FROM auth_sessions
        JOIN auth_users ON auth_users.id = auth_sessions.user_id
        WHERE auth_sessions.token_hash = ${hashSessionToken(token)}
          AND auth_sessions.expires_at > now()
      `;
      return user ?? null;
    });
  }

  /** Validates the supplied code and atomically applies the invitation attempt limit. */
  async redeemInvitation(userId: string, suppliedCode: string): Promise<InvitationRedemption> {
    const validation = validateInvitationCode(suppliedCode);
    if (validation === "missing-configuration") return validation;
    const codeAccepted = validation === "valid";
    return this.#database.transaction(async (sql) => {
      const [state] = await sql<InvitationStateRow[]>`
        SELECT membership_status, invitation_attempt_count, invitation_locked_until
        FROM auth_users
        WHERE id = ${userId}
        FOR UPDATE
      `;
      if (!state) throw new Error("Authenticated user was not found.");
      if (state.membershipStatus === "active") return "active";
      if (state.invitationLockedUntil && state.invitationLockedUntil > new Date()) return "locked";
      if (codeAccepted) {
        await sql`
          UPDATE auth_users
          SET
            membership_status = 'active',
            activated_at = COALESCE(activated_at, now()),
            invitation_attempt_count = 0,
            invitation_locked_until = NULL
          WHERE id = ${userId}
        `;
        return "active";
      }

      const attemptCount = state.invitationAttemptCount + 1;
      const locked = attemptCount >= MAX_INVITATION_ATTEMPTS;
      await sql`
        UPDATE auth_users
        SET
          invitation_attempt_count = ${locked ? 0 : attemptCount},
          invitation_locked_until = ${locked ? sql`now() + make_interval(mins => ${INVITATION_LOCK_MINUTES})` : null}
        WHERE id = ${userId}
      `;
      return locked ? "locked" : "invalid";
    });
  }

  /** Rejects unknown and pending identities at trusted headless adapter boundaries. */
  async requireActiveUser(userId: string): Promise<SessionUser> {
    const user = await this.#database.run(async (sql) => {
      const [activeUser] = await sql<SessionUser[]>`
        SELECT id, email, name, membership_status
        FROM auth_users
        WHERE id = ${userId} AND membership_status = 'active'
      `;
      return activeUser;
    });
    if (!user) throw new ActiveUserRequiredError();
    return user;
  }

  async deleteSession(token: string): Promise<void> {
    if (!token) return;
    await this.#database.run(async (sql) => {
      await sql`DELETE FROM auth_sessions WHERE token_hash = ${hashSessionToken(token)}`;
    });
  }
}

function hashSessionToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}
