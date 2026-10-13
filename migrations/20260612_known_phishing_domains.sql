CREATE TABLE IF NOT EXISTS known_phishing_domains (
  domain        TEXT PRIMARY KEY,
  source        TEXT NOT NULL DEFAULT 'token_airdrop',
  confirmed_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_kpd_domain ON known_phishing_domains(domain);
