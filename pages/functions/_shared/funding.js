export const ARTWORK_CREATORS = {
  "uncle-vibecoder-trailer-01": "leo_guinan",
  "lobow-spark-trailer-02": "lobow_spark",
  "energy-paintbrush": "leo_guinan",
  "annalea-lab": "annalea_l",
  "vibecamp-grant": "gptbrooke",
  "bloom-party": "distributedkv",
};
export const TOPUP_AMOUNTS = [500, 1000, 2500, 5000, 10000];
export const DEFAULT_SUPPORT_CENTS = 500;
export const FUTURE_RADIO_PROJECT = "future_radio_season_1";
export const STORY_MARKETS_CONTINUATION_PROJECT = "story_markets_continuation";
export const ENCHANTED_NOTEBOOK_PROJECT = "enchanted_notebook";
export const directSupportSchema = `
CREATE TABLE IF NOT EXISTS direct_support_events (
  event_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL UNIQUE,
  project TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'usd',
  status TEXT NOT NULL DEFAULT 'paid',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_direct_support_project_status
  ON direct_support_events (project, status, created_at);
`;
export async function ensureDirectSupportSchema(db) {
  for (const statement of directSupportSchema.split(';').map((s) => s.trim()).filter(Boolean)) await db.prepare(statement).run();
}
export const futureRadioSchema = `
CREATE TABLE IF NOT EXISTS future_radio_support (
  event_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL UNIQUE,
  project TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'usd',
  status TEXT NOT NULL DEFAULT 'paid',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_future_radio_support_status_created
  ON future_radio_support (project, status, created_at);
`;
export async function ensureFutureRadioSchema(db) {
  for (const statement of futureRadioSchema.split(';').map((s) => s.trim()).filter(Boolean)) await db.prepare(statement).run();
}
export const fundingSchema = `
CREATE TABLE IF NOT EXISTS account_topups (
  session_id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL UNIQUE,
  patron_id TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'usd',
  status TEXT NOT NULL DEFAULT 'paid',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS support_allocations (
  id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  patron_id TEXT NOT NULL,
  artwork_id TEXT NOT NULL,
  battle_id TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'usd',
  status TEXT NOT NULL DEFAULT 'allocated',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS creator_payout_accounts (
  patron_id TEXT PRIMARY KEY,
  stripe_account_id TEXT NOT NULL UNIQUE,
  charges_enabled INTEGER NOT NULL DEFAULT 0,
  payouts_enabled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_account_topups_patron ON account_topups (patron_id, status);
CREATE INDEX IF NOT EXISTS idx_support_allocations_patron ON support_allocations (patron_id, status);
CREATE TABLE IF NOT EXISTS payout_batches (
  id TEXT PRIMARY KEY,
  cutoff_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'preview',
  total_cents INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  executed_at TEXT
);
CREATE TABLE IF NOT EXISTS payout_items (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL,
  allocation_id TEXT NOT NULL UNIQUE,
  creator_handle TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'eligible',
  stripe_transfer_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_payout_items_batch ON payout_items (batch_id, status);
CREATE INDEX IF NOT EXISTS idx_payout_items_creator ON payout_items (creator_handle, status);
`;

export async function ensureFundingSchema(db) {
  for (const statement of fundingSchema.split(';').map((s) => s.trim()).filter(Boolean)) await db.prepare(statement).run();
}
export function validAmount(value) { return Number.isInteger(value) && TOPUP_AMOUNTS.includes(value); }
export function randomId(prefix) { return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`; }
