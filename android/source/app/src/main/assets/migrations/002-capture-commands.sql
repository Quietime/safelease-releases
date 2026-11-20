-- Additive migration for existing v0.4 stores; no original evidence is rewritten.
CREATE TABLE IF NOT EXISTS capture_commands(user_id TEXT NOT NULL REFERENCES accounts(id),request_id TEXT NOT NULL,lease_id TEXT NOT NULL REFERENCES leases(id),fingerprint TEXT NOT NULL,photo_id TEXT NOT NULL REFERENCES photos(id),version_id TEXT NOT NULL REFERENCES versions(id),created INTEGER NOT NULL,PRIMARY KEY(user_id,request_id));
CREATE TRIGGER IF NOT EXISTS capture_commands_no_update BEFORE UPDATE ON capture_commands BEGIN SELECT RAISE(ABORT,'immutable_capture_command'); END;
CREATE TRIGGER IF NOT EXISTS capture_commands_no_delete BEFORE DELETE ON capture_commands BEGIN SELECT RAISE(ABORT,'immutable_capture_command'); END;
