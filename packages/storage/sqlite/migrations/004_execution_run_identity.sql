ALTER TABLE execution_run ADD COLUMN provider_ref_json TEXT CHECK (provider_ref_json IS NULL OR (json_valid(provider_ref_json) AND json_type(provider_ref_json) = 'object'));
ALTER TABLE execution_run ADD COLUMN fallback INTEGER NOT NULL DEFAULT 0 CHECK (fallback IN (0, 1));
