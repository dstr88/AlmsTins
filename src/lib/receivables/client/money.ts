/**
 * How the receivables pages write an amount: currency code, then en-US digits (`NGN 1,234.00`).
 * The one formatter is src/lib/format.ts; re-exported here because the host pages' scripts import
 * only receivables modules (tests/receivables/componentSplit.test.ts).
 */
export { formatMoney } from '@/lib/format';
