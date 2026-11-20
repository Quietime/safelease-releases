-- Additive workflow metadata; confirmed versions and originals are not rewritten.
CREATE TABLE IF NOT EXISTS listing_intakes(screening_id TEXT PRIMARY KEY REFERENCES screenings(id),listing_url TEXT NOT NULL,phone TEXT NOT NULL,address TEXT NOT NULL,post_text TEXT NOT NULL,prepay INTEGER NOT NULL,screenshot BLOB,screenshot_mime TEXT NOT NULL,created INTEGER NOT NULL);
CREATE TRIGGER IF NOT EXISTS intake_no_update BEFORE UPDATE ON listing_intakes BEGIN SELECT RAISE(ABORT,'immutable_listing_intake'); END;
CREATE TRIGGER IF NOT EXISTS intake_no_delete BEFORE DELETE ON listing_intakes BEGIN SELECT RAISE(ABORT,'immutable_listing_intake'); END;
CREATE TABLE IF NOT EXISTS lease_plans(lease_id TEXT PRIMARY KEY REFERENCES leases(id),owner_name TEXT NOT NULL,rooms TEXT NOT NULL,renewal_end TEXT NOT NULL,updated INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS evidence_drafts(lease_id TEXT NOT NULL REFERENCES leases(id),user_id TEXT NOT NULL REFERENCES accounts(id),letter TEXT NOT NULL,attachments TEXT NOT NULL,updated INTEGER NOT NULL,PRIMARY KEY(lease_id,user_id));
