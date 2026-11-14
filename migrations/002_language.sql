-- Additive: existing users keep Spanish until they explicitly choose otherwise.
ALTER TABLE users ADD COLUMN language TEXT NOT NULL DEFAULT 'es' CHECK(language IN ('es','en'));
