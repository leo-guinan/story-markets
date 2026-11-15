ALTER TABLE narratives ADD COLUMN parent_id TEXT REFERENCES narratives(id);
ALTER TABLE narratives ADD COLUMN is_main INTEGER NOT NULL DEFAULT 0 CHECK (is_main IN (0, 1));
ALTER TABLE narratives ADD COLUMN structural_value INTEGER;
ALTER TABLE narratives ADD COLUMN structural_label TEXT;
ALTER TABLE narratives ADD COLUMN structural_deadline TEXT;
ALTER TABLE narratives ADD COLUMN structural_basis TEXT CHECK (structural_basis IS NULL OR structural_basis = 'untyped_scalar');
CREATE UNIQUE INDEX IF NOT EXISTS narratives_one_main_per_owner ON narratives(owner_id) WHERE is_main = 1;
CREATE INDEX IF NOT EXISTS narratives_owner_parent ON narratives(owner_id, parent_id, created_at);
