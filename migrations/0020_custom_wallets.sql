-- Custom wallet support
-- Adds wallet_type to distinguish synced on-chain wallets from manually managed custom wallets.
-- Existing wallets default to 'onchain'. Custom wallets may have a generated placeholder address.

ALTER TABLE wallets ADD COLUMN wallet_type TEXT NOT NULL DEFAULT 'onchain';
