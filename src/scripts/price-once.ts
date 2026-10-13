import 'dotenv/config';
import { priceMissingTransactionsForTenant } from '@/lib/priceMissingTransactionsForTenant';

const tenantId = process.env.TENANT_ID ?? 'default';
const allowDefaultTenant =
  process.env.NODE_ENV !== 'production' || process.env.ALLOW_DEFAULT_TENANT === '1';

if (tenantId === 'default' && !allowDefaultTenant) {
  throw new Error('TENANT_ID is required in production unless ALLOW_DEFAULT_TENANT=1');
}

async function run() {
  console.log('[price-once] tenant:', tenantId);

  const result = await priceMissingTransactionsForTenant(tenantId, {
    interval: '1h',
    limit: 1500,
  });

  console.log('[price-once] result:', JSON.stringify(result, null, 2));
}

run().catch((err) => {
  console.error('[price-once] fatal error:', err);
  process.exit(1);
});
