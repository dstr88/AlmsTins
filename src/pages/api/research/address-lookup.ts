/**
 * GET /api/research/address-lookup?address=0x…
 *
 * Checks:
 *   1. Tenant's own wallets table
 *   2. Tenant's address_labels table
 *   3. Hardcoded map of known exchange hot wallets
 *   4. Recent import_transactions mentioning the address
 */

import type { APIRoute } from 'astro';
import { db } from '@/lib/db';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { getLang } from '@/lib/i18n/locale';
import { getResearchErrors } from '@/i18n/apiErrors/research';

export const prerender = false;

// Well-known exchange hot wallet / deposit addresses (EVM, lowercase)
const KNOWN_EXCHANGES: Record<string, string> = {
  // Binance
  '0x28c6c06298d514db089934071355e5743bf21d60': 'Binance',
  '0xdfd5293d8e347dfe59e90efd55b2956a1343963d': 'Binance',
  '0x56eddb7aa87536c09ccc2793473599fd21a8b17f': 'Binance',
  '0x21a31ee1afc51d94c2efccaa2092ad1028285549': 'Binance',
  '0xb38e8c17e38363af6ebdcb3dae12e0243582891d': 'Binance',
  '0xbe0eb53f46cd790cd13851d5eff43d12404d33e8': 'Binance',
  // Coinbase
  '0xa9d1e08c7793af67e9d92fe308d5697fb81d3e43': 'Coinbase',
  '0x71660c4005ba85c37ccec55d0c4493e66fe775d3': 'Coinbase',
  '0x503828976d22510aad0201ac7ec88293211d23da': 'Coinbase',
  '0xddfabcdc4d8ffc6d5beaf154f18b778f892a0740': 'Coinbase',
  '0x3cd751e6b0078be393132286c442345e5dc49699': 'Coinbase',
  // Kraken
  '0x2910543af39aba0cd09dbb2d50200b3e800a63d2': 'Kraken',
  '0x0a869d79a7052c7f1b55a8ebabbea3420f0d1e13': 'Kraken',
  '0xe853c56864a2ebe4576a807d26fdc4a0ada51919': 'Kraken',
  // Gemini
  '0xd24400ae8bfebb18ca49be86258a3c749cf46853': 'Gemini',
  '0x07ee55aa48bb72dcc6e9d78256648910de513eca': 'Gemini',
  '0x6fc82a5fe25a5cdb58bc74600a40a69c065263f8': 'Gemini',
  // OKX
  '0x6cc5f688a315f3dc28a7781717a9a798a59fda7b': 'OKX',
  '0x98ec059dc3adfbdd63429454aeb0c990fba4a128': 'OKX',
  // Huobi / HTX
  '0xab5c66752a9e8167967685f1450532fb96d5d24f': 'Huobi',
  '0x6748f50f686bfbca6fe8ad62b22228b87f31ff2b': 'Huobi',
  '0xfdb16996831753d5331ff813c29a93c76834a0ad': 'Huobi',
  // KuCoin
  '0xa1d8d972560c37e37beaea22fc38a6c3e990d2c2': 'KuCoin',
  '0xe176ebe47d621b984a73036b9da5d834411ef734': 'KuCoin',
  // Crypto.com
  '0x6262998ced04146fa42253a5c0af90ca02dfd2a3': 'Crypto.com',
  '0x46340b20830761efd32832a74d7169b29feb9758': 'Crypto.com',
  // Bybit
  '0xf89d7b9c864f589bbf53a82105107622b35eaa40': 'Bybit',
  '0x1ab4973a48dc892cd9971ece8e01dcc7688f8f23': 'Bybit',
  // Bitfinex
  '0x77134cbc06cb00b66f4c7e623d5fdbf6777635ec': 'Bitfinex',
  '0x1151314c646ce4e0efd76d1af4760ae66a9fe30f': 'Bitfinex',
  // Robinhood
  '0x73af4fd5d3deab2a5f72b3bb8a8f7f9b74f4d8e3': 'Robinhood',
  // Gate.io
  '0x0d0707963952f2fba59dd06f2b425ace40b492fe': 'Gate.io',
  // MEXC
  '0x75e89d5979e4f6fba9f97c104f2f4ccd700a6be6': 'MEXC',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export const GET: APIRoute = async ({ request }) => {
  const session = await requireTenantSession(request);
  if (!session) return new Response('Unauthorized', { status: 401 });
  const { tenantId } = session;
  const t = getResearchErrors(getLang(request));

  const url     = new URL(request.url);
  const raw     = url.searchParams.get('address')?.trim() ?? '';
  const address = raw.toLowerCase();

  if (!address) return json({ error: t.addressRequired }, 400);

  // 1. Tenant's own wallets
  const walletRes = await db.execute({
    sql: `SELECT id, address, label, chains, wallet_type
          FROM wallets WHERE tenant_id = ? AND lower(address) = ? LIMIT 1`,
    args: [tenantId, address],
  });
  const ownWallet = walletRes.rows[0] ?? null;

  // 2. Address labels stored for this tenant
  const labelRes = await db.execute({
    sql: `SELECT label, source FROM address_labels
          WHERE tenant_id = ? AND lower(address) = ? LIMIT 1`,
    args: [tenantId, address],
  });
  const addressLabel       = (labelRes.rows[0]?.label  as string | null) ?? null;
  const addressLabelSource = (labelRes.rows[0]?.source as string | null) ?? null;

  // 2b. Community-promoted global label (only used if no personal label)
  let globalLabel: string | null = null;
  if (!addressLabel) {
    const globalRes = await db.execute({
      sql: `SELECT label FROM global_address_labels WHERE address = ? LIMIT 1`,
      args: [address],
    });
    globalLabel = (globalRes.rows[0]?.label as string | null) ?? null;
  }

  // 3. Known exchange map
  const knownExchange = KNOWN_EXCHANGES[address] ?? null;

  // 4. Recent transactions linked to this wallet or mentioning the address
  let recentTxs: unknown[] = [];
  if (ownWallet) {
    const txRes = await db.execute({
      sql: `SELECT id, source, timestamp_utc, direction, asset_symbol, amount, native_usd, kind, description
            FROM import_transactions
            WHERE tenant_id = ? AND wallet_id = ?
            ORDER BY timestamp_utc DESC LIMIT 8`,
      args: [tenantId, String(ownWallet.id)],
    });
    recentTxs = txRes.rows;
  } else {
    const txRes = await db.execute({
      sql: `SELECT id, source, timestamp_utc, direction, asset_symbol, amount, native_usd, kind, description
            FROM import_transactions
            WHERE tenant_id = ? AND (lower(tx_hash) LIKE ? OR lower(description) LIKE ?)
            ORDER BY timestamp_utc DESC LIMIT 8`,
      args: [tenantId, `%${address}%`, `%${address}%`],
    });
    recentTxs = txRes.rows;
  }

  return json({
    address: raw,
    ownWallet: ownWallet
      ? {
          id:         String(ownWallet.id),
          label:      String(ownWallet.label ?? ''),
          address:    String(ownWallet.address),
          chains:     ownWallet.chains,
          walletType: String(ownWallet.wallet_type ?? 'onchain'),
        }
      : null,
    addressLabel,
    addressLabelSource,
    globalLabel,
    knownExchange,
    recentTxs,
  });
};
