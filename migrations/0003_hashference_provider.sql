-- Expand the provider allowlist while preserving existing keys and generation receipts.
CREATE TABLE provider_credentials_new (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('openrouter', 'hashference')),
  label TEXT NOT NULL,
  masked_secret TEXT NOT NULL,
  encrypted_secret TEXT,
  status TEXT NOT NULL CHECK (status IN ('active', 'revoked')) DEFAULT 'active',
  created_at TEXT NOT NULL,
  revoked_at TEXT
);

INSERT INTO provider_credentials_new (id, owner_id, provider, label, masked_secret, encrypted_secret, status, created_at, revoked_at)
SELECT id, owner_id, provider, label, masked_secret, encrypted_secret, status, created_at, revoked_at
FROM provider_credentials;

CREATE TABLE generations_new (
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
  FOREIGN KEY(credential_id) REFERENCES provider_credentials_new(id)
);

INSERT INTO generations_new (id, owner_id, narrative_id, credential_id, provider, model, prompt, status, output, provider_request_id, usage_json, failure_code, created_at, completed_at)
SELECT id, owner_id, narrative_id, credential_id, provider, model, prompt, status, output, provider_request_id, usage_json, failure_code, created_at, completed_at
FROM generations;

DROP TABLE generations;
DROP TABLE provider_credentials;
ALTER TABLE provider_credentials_new RENAME TO provider_credentials;
ALTER TABLE generations_new RENAME TO generations;

CREATE INDEX credentials_owner_status ON provider_credentials(owner_id, status, created_at DESC);
CREATE INDEX generations_owner_created ON generations(owner_id, created_at DESC);
CREATE INDEX generations_narrative_created ON generations(narrative_id, created_at DESC);