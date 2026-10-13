import { runTaxPipeline } from '../src/lib/yearEnd/classify';

const tenantId = process.argv[2] ?? 'fc236bc3-f032-4064-aea4-1e5e1fa503b1';
console.log(`Running pipeline for tenant: ${tenantId}`);
const stats = await runTaxPipeline(tenantId);
console.log('Done:', JSON.stringify(stats, null, 2));
process.exit(0);
