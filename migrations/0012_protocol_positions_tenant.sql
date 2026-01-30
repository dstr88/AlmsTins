ALTER TABLE protocol_positions
	ADD COLUMN IF NOT EXISTS tenant_id TEXT;

ALTER TABLE protocol_positions
	ADD COLUMN IF NOT EXISTS wallet_id TEXT;

UPDATE protocol_positions
SET tenant_id = (
	SELECT tenant_id
	FROM wallets
	WHERE wallets.id = protocol_positions.wallet_id
	LIMIT 1
)
WHERE tenant_id IS NULL AND wallet_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_protocol_positions_tenant_wallet
	ON protocol_positions (tenant_id, wallet_id);
