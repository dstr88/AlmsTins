import 'dotenv/config';
import { priceMissingTransactionsForTenant } from '../lib/priceMissingTransactionsForTenant';

console.log('[price-once] boot');

const tenantId = process.env.TENANT_ID;

if (!tenantId) {
  console.error('❌ TENANT_ID env var is required');
  process.exit(1);
}

const safeTenantId: string = tenantId;

async function run() {
  console.log('[price-once] calling job...');
  const result = await priceMissingTransactionsForTenant(safeTenantId, {
    interval: '1h',
    limit: 1500,
  });
  console.log('✅ Pricing run complete:', result);
}

run()
  .then(() => {
    console.log('[price-once] done');
    process.exit(0);
  })
  .catch((err) => {
    console.error('[price-once] error', err);
    process.exit(1);
  });
