-- Additive: existing users keep Spanish until they explicitly choose otherwise.
ALTER TABLE users ADD COLUMN language TEXT COLLATE "C" NOT NULL DEFAULT 'es' CHECK(language IN ('es','en'));
