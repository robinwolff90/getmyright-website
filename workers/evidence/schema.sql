-- GetMyRight Beleg-Datenbank (Cloudflare D1, Zuständigkeit EU). Keine Klartext-E-Mails, keine Dateiinhalte.
-- Personenbezogene Kleindaten (E-Mail, Dateiname, TOTP-Secret) liegen nur verschlüsselt vor (*_enc),
-- Suchfelder nur als geheimer HMAC (*_hash).

CREATE TABLE IF NOT EXISTS cases (
  id TEXT PRIMARY KEY,                 -- zufällige UUID
  status TEXT NOT NULL,                -- entwurf | offen | uebernommen | geschlossen
  answers TEXT NOT NULL,               -- JSON der 5 Fragen (Anbieter, Spielart, Zeitraum, Verlust-Spanne, Bundesland)
  consent_version TEXT NOT NULL,
  consent_at INTEGER NOT NULL,
  email_hash TEXT,                     -- erst nach Bestätigung am Ende ("Fall zuerst, Konto später")
  email_enc TEXT,
  confirmed_at INTEGER,
  claimed_by TEXT,                     -- kanzleien.id
  claimed_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cases_status ON cases(status);
CREATE INDEX IF NOT EXISTS idx_cases_email ON cases(email_hash);
CREATE INDEX IF NOT EXISTS idx_cases_claimed ON cases(claimed_by);

CREATE TABLE IF NOT EXISTS checklist_marks (
  case_id TEXT NOT NULL,
  item TEXT NOT NULL,                  -- kontoauszug | spielverlauf | oasis
  status TEXT NOT NULL,                -- angefordert (vom Spieler beim Anbieter angefragt)
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (case_id, item)
);

CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL,
  item TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,               -- Klartextgröße in Byte
  name_enc TEXT NOT NULL,              -- Original-Dateiname, verschlüsselt
  sha256 TEXT NOT NULL,                -- Prüfsumme des Klartexts (Integrität, Duplikate)
  key_id TEXT NOT NULL,
  iv TEXT NOT NULL,
  wrapped_dek TEXT NOT NULL,
  converted INTEGER NOT NULL DEFAULT 0, -- 1 = im Browser umgewandelt/verkleinert
  created_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_files_case ON files(case_id);

CREATE TABLE IF NOT EXISTS sessions (
  id_hash TEXT PRIMARY KEY,            -- HMAC des Bearer-Tokens, Token selbst wird nie gespeichert
  kind TEXT NOT NULL,                  -- spieler | kanzlei | kanzlei_pending
  subject TEXT NOT NULL,               -- Fall-ID, E-Mail-Hash (Spieler) oder Kanzlei-ID
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_exp ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS login_codes (
  email_hash TEXT NOT NULL,
  purpose TEXT NOT NULL,               -- spieler_bestaetigen | spieler_login | kanzlei_login
  code_hash TEXT NOT NULL,             -- 6-stelliger Code
  link_hash TEXT NOT NULL,             -- Magic-Link-Token
  case_id TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (email_hash, purpose)
);

CREATE TABLE IF NOT EXISTS kanzleien (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email_hash TEXT NOT NULL UNIQUE,
  email_enc TEXT NOT NULL,
  totp_secret_enc TEXT,                -- gesetzt nach Einrichtung, Pflicht für jeden Login
  totp_confirmed INTEGER NOT NULL DEFAULT 0,
  totp_last_counter INTEGER NOT NULL DEFAULT -1,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS devices (    -- "Gerät 30 Tage merken"
  id_hash TEXT PRIMARY KEY,
  kanzlei_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  actor_kind TEXT NOT NULL,            -- spieler | kanzlei | system
  actor_id TEXT,                       -- Fall-ID bzw. Kanzlei-ID, nie E-Mail
  action TEXT NOT NULL,                -- fall_angelegt, beleg_hochgeladen, beleg_geloescht, bestaetigt, uebernommen, link_erstellt, beleg_abgerufen, login, ...
  case_id TEXT,
  file_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_case ON audit(case_id);
