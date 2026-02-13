import 'dotenv/config';
import { priceMissingTransactionsForTenant } from '@/lib/priceMissingTransactionsForTenant';

const tenantId = process.env.TENANT_ID ?? 'default';

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
