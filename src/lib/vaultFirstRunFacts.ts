/**
 * Wallet Watcher: the facts the Vault's first-run rule needs, read for one tenant (server side).
 *
 * The rule itself is pure and lives in ./vaultFirstRun.ts. The Vault page has already read the
 * account's wallets, so this file only reads what is left: whether the account holds an exchange
 * account or an imported transaction. The demo is not read at all (the rule answers it without).
 *
 * A read that fails answers "unknown" (importCount null), which the rule treats as not first-run:
 * the account gets the Vault as it always was, never a welcome it may not need.
 */
import { db } from './db';
import type { VaultFirstRunFacts } from './vaultFirstRun';

const IMPORTS_SQL = `SELECT
	EXISTS (SELECT 1 FROM exchange_accounts WHERE tenant_id = ?) AS has_exchange,
	EXISTS (SELECT 1 FROM import_transactions WHERE tenant_id = ?) AS has_import`;

const truthy = (v: unknown) => v === true || v === 1 || v === '1' || v === 't' || v === 'true';

export async function loadVaultFirstRunFacts(input: {
	tenantId: string;
	isDemo: boolean;
	walletCount: number;
}): Promise<VaultFirstRunFacts> {
	const { tenantId, isDemo, walletCount } = input;
	if (isDemo) return { isDemo: true, walletCount, importCount: null };
	// An account with a wallet is past first run; nothing more to read.
	if (walletCount > 0) return { isDemo: false, walletCount, importCount: null };
	try {
		const res = await db.execute({ sql: IMPORTS_SQL, args: [tenantId, tenantId] });
		const row = (res.rows[0] ?? {}) as Record<string, unknown>;
		const importCount = (truthy(row.has_exchange) ? 1 : 0) + (truthy(row.has_import) ? 1 : 0);
		return { isDemo: false, walletCount, importCount };
	} catch (err) {
		console.error('[vault] first-run facts not read:', err instanceof Error ? err.message : err);
		return { isDemo: false, walletCount, importCount: null };
	}
}
