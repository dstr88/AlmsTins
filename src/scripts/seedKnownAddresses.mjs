/**
 * Seed well-known protocol contract addresses into global_address_labels.
 * Safe to run multiple times — uses INSERT OR IGNORE.
 *
 *   npm run seed:addresses
 */

import 'dotenv/config';
import { createClient } from '@libsql/client';

const db = createClient({
  url:       process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

// ── Add columns if they don't exist yet ───────────────────────────────────────
async function ensureColumns() {
  const alterStatements = [
    `ALTER TABLE global_address_labels ADD COLUMN category TEXT DEFAULT 'defi'`,
    `ALTER TABLE global_address_labels ADD COLUMN chain    TEXT`,
    `ALTER TABLE global_address_labels ADD COLUMN protocol TEXT`,
    `ALTER TABLE address_labels         ADD COLUMN category TEXT DEFAULT 'counterparty'`,
    `ALTER TABLE address_labels         ADD COLUMN chain    TEXT`,
    `ALTER TABLE address_labels         ADD COLUMN notes    TEXT`,
  ];
  for (const sql of alterStatements) {
    try {
      await db.execute(sql);
    } catch {
      // Column already exists — ignore
    }
  }
  console.log('✓ Columns ensured');
}

// ── Known addresses ───────────────────────────────────────────────────────────
// Source: bgd-labs/aave-address-book (official Aave deployment registry)
const KNOWN = [
  // ── Aave V3 · Ethereum Mainnet ────────────────────────────────────────────
  {
    address:  '0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2',
    label:    'Aave V3 Pool · Ethereum',
    category: 'defi',
    chain:    'ethereum',
    protocol: 'aave',
  },
  {
    address:  '0xd01607c3c5ecaba394d8be377a08590149325722',
    label:    'Aave V3 WETH Gateway · Ethereum',
    category: 'defi',
    chain:    'ethereum',
    protocol: 'aave',
  },

  // ── Aave V3 · Polygon ─────────────────────────────────────────────────────
  {
    address:  '0x794a61358d6845594f94dc1db02a252b5b4814ad',
    label:    'Aave V3 Pool · Polygon / Avalanche',
    category: 'defi',
    chain:    'polygon',       // same address on Avalanche — labeled both
    protocol: 'aave',
  },
  {
    address:  '0xbc302053db3aa514a3c86b9221082f162b91ad63',
    label:    'Aave V3 WMATIC Gateway · Polygon',
    category: 'defi',
    chain:    'polygon',
    protocol: 'aave',
  },

  // ── Aave V3 · Avalanche C-Chain ───────────────────────────────────────────
  // Pool address is shared with Polygon (CREATE2 deterministic deployment)
  {
    address:  '0x2825ce5921538d17cc15ae00a8b24ff759c6cdae',
    label:    'Aave V3 WAVAX Gateway · Avalanche',
    category: 'defi',
    chain:    'avalanche',
    protocol: 'aave',
  },
];

async function seed() {
  await ensureColumns();

  let inserted = 0;
  let skipped  = 0;

  for (const entry of KNOWN) {
    try {
      const result = await db.execute({
        sql: `INSERT INTO global_address_labels (address, label, vote_count, category, chain, protocol)
              VALUES (?, ?, 0, ?, ?, ?)
              ON CONFLICT (address) DO NOTHING`,
        args: [entry.address, entry.label, entry.category, entry.chain, entry.protocol],
      });
      if (result.rowsAffected > 0) {
        console.log(`  ✓ ${entry.label}`);
        inserted++;
      } else {
        console.log(`  — already exists: ${entry.label}`);
        skipped++;
      }
    } catch (err) {
      console.error(`  ✗ ${entry.label}:`, err.message);
    }
  }

  console.log(`\nDone — ${inserted} inserted, ${skipped} skipped`);
  process.exit(0);
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
