-- Add contract_address to transactions so we can identify token contracts.
-- ERC-20 transfers from Etherscan/Routescan always include contractAddress.
ALTER TABLE transactions ADD COLUMN contract_address TEXT;

-- Add contract_address to lifecycle events (propagated from transactions).
ALTER TABLE asset_lifecycle_events ADD COLUMN contract_address TEXT;
