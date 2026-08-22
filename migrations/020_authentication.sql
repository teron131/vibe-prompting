-- Creates Google-backed application identities and revocable opaque browser sessions for invitation-gated access.

CREATE TABLE auth_users (
  id uuid PRIMARY KEY,
  google_subject text NOT NULL UNIQUE,
  email text NOT NULL,
  name text,
  image_url text,
  membership_status text NOT NULL DEFAULT 'pending' CHECK (membership_status IN ('pending', 'active')),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_signed_in_at timestamptz NOT NULL DEFAULT now(),
  activated_at timestamptz
);

CREATE TABLE auth_sessions (
  token_hash text PRIMARY KEY CHECK (length(token_hash) = 64),
  user_id uuid NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE INDEX auth_sessions_user_id_idx ON auth_sessions(user_id);
CREATE INDEX auth_sessions_expires_at_idx ON auth_sessions(expires_at);
