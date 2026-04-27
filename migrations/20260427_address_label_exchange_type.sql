-- Introduce 'exchange' as a formal category for CEX/platform addresses.
-- Before this, auto-created labels had category = 'counterparty' regardless
-- of whether the address belongs to an exchange or a personal wallet.
-- After: 'own_wallet' = personal wallets the user controls,
--        'exchange'   = CEX platform addresses (Coinbase, Gemini, etc.)

-- 1. Unify 'personal' into 'own_wallet' (earlier attempt at same concept)
UPDATE address_labels
SET    category   = 'own_wallet',
       updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
WHERE  category = 'personal';

-- 2. cex: prefixed virtual addresses are exchange account addresses by definition
UPDATE address_labels
SET    category   = 'exchange',
       updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
WHERE  address LIKE 'cex:%'
  AND  (category IS NULL OR category NOT IN ('own_wallet', 'exchange'));

-- 3. Exodus is a personal wallet app — override its cex: entry back to own_wallet
UPDATE address_labels
SET    category   = 'own_wallet',
       updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
WHERE  address LIKE 'cex:exodus:%';

-- 4. Real blockchain addresses auto-labeled with known exchange names
UPDATE address_labels
SET    category   = 'exchange',
       updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
WHERE  source = 'auto'
  AND  (category IS NULL OR category = 'counterparty')
  AND  label IN (
         'Coinbase', 'Crypto.com', 'Gemini', 'Kraken',
         'Venmo', 'Cash App', 'Robinhood', 'Binance',
         'KuCoin', 'Bybit', 'OKX', 'Bitfinex'
       );
