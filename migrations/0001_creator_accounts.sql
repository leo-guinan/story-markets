CREATE TABLE IF NOT EXISTS narratives (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  title TEXT NOT NULL,
  premise TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('private_draft', 'review', 'approved', 'archived')) DEFAULT 'private_draft',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS narratives_owner_updated ON narratives(owner_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS provider_credentials (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('openrouter')),
  label TEXT NOT NULL,
  masked_secret TEXT NOT NULL,
  encrypted_secret TEXT,
  status TEXT NOT NULL CHECK (status IN ('active', 'revoked')) DEFAULT 'active',
  created_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS credentials_owner_status ON provider_credentials(owner_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS generations (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  narrative_id TEXT NOT NULL,
  credential_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
  output TEXT,
  provider_request_id TEXT,
  usage_json TEXT,
  failure_code TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  FOREIGN KEY(narrative_id) REFERENCES narratives(id),
  FOREIGN KEY(credential_id) REFERENCES provider_credentials(id)
);
CREATE INDEX IF NOT EXISTS generations_owner_created ON generations(owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS generations_narrative_created ON generations(narrative_id, created_at DESC);
