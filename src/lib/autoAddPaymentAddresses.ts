import { db } from '@/lib/db';
import { logActivity } from '@/lib/activityLog';
import { randomUUID } from 'node:crypto';

export async function autoAddNewPaymentAddresses(tenantId: string): Promise<number> {
  try {
    // 1. Check subscription tier — skip if free
    const subResult = await db.execute({
      sql: `SELECT tier FROM subscriptions WHERE tenant_id = ? AND tier IN ('starter', 'pro', 'unlimited')`,
      args: [tenantId],
    });
    const subscription = subResult.rows[0] as any;

    if (!subscription) {
      // Free tier user, skip auto-add
      return 0;
    }

    // 2. Check user setting — skip if disabled
    const settingsResult = await db.execute({
      sql: `SELECT auto_add_addresses FROM user_settings WHERE tenant_id = ?`,
      args: [tenantId],
    });
    const settings = settingsResult.rows[0] as any;

    if (settings && Number(settings.auto_add_addresses) === 0) {
      // User disabled auto-add
      return 0;
    }

    // 3. Find all OUT/withdrawal transactions with a destination address
    const outResult = await db.execute({
      sql: `SELECT DISTINCT it.to_address, it.description, it.source, it.asset_symbol
       FROM import_transactions it
       WHERE it.tenant_id = ?
       AND it.direction = 'out'
       AND it.to_address IS NOT NULL
       AND it.to_address NOT IN (
         SELECT DISTINCT address FROM address_labels WHERE tenant_id = ?
       )
       ORDER BY it.timestamp_utc DESC
       LIMIT 100`,
      args: [tenantId, tenantId],
    });
    const outTransactions = outResult.rows as any[];

    // Also check on-chain transactions
    const onChainResult = await db.execute({
      sql: `SELECT DISTINCT t.to_address, t.metadata_json, t.chain
       FROM transactions t
       WHERE t.tenant_id = ?
       AND t.to_address IS NOT NULL
       AND t.to_address NOT IN (
         SELECT DISTINCT address FROM address_labels WHERE tenant_id = ?
       )
       ORDER BY t.timestamp DESC
       LIMIT 100`,
      args: [tenantId, tenantId],
    });
    const onChainOuts = onChainResult.rows as any[];

    const allOuts = [...outTransactions, ...onChainOuts];
    const uniqueAddresses = new Map<string, string>();

    // Deduplicate and extract label
    for (const tx of allOuts) {
      const addr = (tx.to_address || tx.address) as string | undefined;
      if (addr && !uniqueAddresses.has(addr)) {
        const label = extractLabel(tx);
        uniqueAddresses.set(addr, label);
      }
    }

    let addedCount = 0;

    // Insert addresses into address_labels (auto-source, counterparty category)
    for (const [address, label] of uniqueAddresses) {
      try {
        await db.execute({
          sql: `INSERT OR IGNORE INTO address_labels
           (id, tenant_id, address, label, source, category, chain, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'auto', 'counterparty', NULL, datetime('now'), datetime('now'))`,
          args: [randomUUID(), tenantId, address, label],
        });
        addedCount++;
      } catch (err) {
        // Duplicate or constraint violation, skip
        console.warn(`Failed to add address ${address}:`, err);
      }
    }

    if (addedCount > 0) {
      logActivity(tenantId, 'auto_added_addresses', `${addedCount} address(es) auto-added`, {
        count: addedCount,
      });
    }

    return addedCount;
  } catch (error) {
    console.error('Error in autoAddNewPaymentAddresses:', error);
    return 0;
  }
}

function extractLabel(tx: any): string {
  // Try to extract label from transaction metadata

  // 1. Check description for address or recognizable patterns
  if (tx.description) {
    const desc = tx.description.toLowerCase();

    // Look for exchange/source names
    if (desc.includes('coinbase')) return 'Coinbase';
    if (desc.includes('kraken')) return 'Kraken';
    if (desc.includes('gemini')) return 'Gemini';
    if (desc.includes('crypto.com')) return 'Crypto.com';
    if (desc.includes('binance')) return 'Binance';
    if (desc.includes('uniswap')) return 'Uniswap';
    if (desc.includes('opensea')) return 'OpenSea';
    if (desc.includes('lido')) return 'Lido';
    if (desc.includes('aave')) return 'Aave';

    // Otherwise use first 50 chars of description as label
    if (tx.description.length > 0) {
      return tx.description.slice(0, 50);
    }
  }

  // 2. Check source field (for import_transactions)
  if (tx.source) {
    const sourceMap: Record<string, string> = {
      'crypto_com': 'Crypto.com',
      'gemini': 'Gemini',
      'kraken': 'Kraken',
      'coinbase': 'Coinbase',
      'binance': 'Binance',
      'exodus': 'Exodus',
      'solana': 'Solana Wallet',
      'bitcoin': 'Bitcoin Wallet',
      'ethereum': 'Ethereum Wallet',
    };

    const mappedSource = sourceMap[tx.source.toLowerCase()];
    if (mappedSource) return mappedSource + ' Withdrawal';

    return tx.source + ' Withdrawal';
  }

  // 3. Check chain (for on-chain transactions)
  if (tx.chain) {
    return tx.chain.charAt(0).toUpperCase() + tx.chain.slice(1) + ' Payment';
  }

  // 4. Fallback: Use truncated address
  const addr = tx.to_address || tx.address || '';
  if (addr.length > 10) {
    return addr.slice(0, 6) + '...' + addr.slice(-4);
  }

  return 'Payment';
}
