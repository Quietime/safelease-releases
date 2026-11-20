-- Private checks before any lease exists. Linking creates a fixed lease-visible snapshot.
CREATE TABLE IF NOT EXISTS screenings(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL REFERENCES accounts(id),title TEXT NOT NULL,lease_id TEXT UNIQUE REFERENCES leases(id),created INTEGER NOT NULL,linked_at INTEGER);
CREATE TABLE IF NOT EXISTS screening_checks(id TEXT PRIMARY KEY,screening_id TEXT NOT NULL REFERENCES screenings(id),user_id TEXT NOT NULL REFERENCES accounts(id),kind TEXT NOT NULL,object TEXT NOT NULL,source TEXT NOT NULL,status TEXT NOT NULL,result TEXT NOT NULL,created INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS screening_owner ON screenings(owner_id,created);
CREATE INDEX IF NOT EXISTS screening_check_parent ON screening_checks(screening_id,created);
CREATE TRIGGER IF NOT EXISTS screening_checks_no_update BEFORE UPDATE ON screening_checks BEGIN SELECT RAISE(ABORT,'immutable_screening_check'); END;
CREATE TRIGGER IF NOT EXISTS screening_checks_no_delete BEFORE DELETE ON screening_checks BEGIN SELECT RAISE(ABORT,'immutable_screening_check'); END;
CREATE TRIGGER IF NOT EXISTS screening_checks_no_append_after_link BEFORE INSERT ON screening_checks WHEN (SELECT lease_id FROM screenings WHERE id=NEW.screening_id) IS NOT NULL BEGIN SELECT RAISE(ABORT,'screening_already_linked'); END;
CREATE TRIGGER IF NOT EXISTS screenings_link_once BEFORE UPDATE ON screenings WHEN NOT(OLD.lease_id IS NULL AND NEW.lease_id IS NOT NULL AND NEW.linked_at IS NOT NULL AND OLD.id=NEW.id AND OLD.owner_id=NEW.owner_id AND OLD.title=NEW.title AND OLD.created=NEW.created) BEGIN SELECT RAISE(ABORT,'immutable_screening'); END;
