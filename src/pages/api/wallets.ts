import type { APIRoute } from 'astro';
import { db } from '../../lib/db';
import { normalizeChains, sanitizeAddress, transformWalletRow } from '../../lib/wallets-service';
import { deriveDefaultLabel } from '../../lib/wallets';
import { requireTenantSession } from '../../lib/requireTenantSession';
import { checkWalletLimit } from '../../lib/subscriptions';
import { DEMO_TENANT_ID, DEMO_WALLET_CONFIGS, isDemoWalletAddress } from '../../lib/demo';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
	try {
		const session = await requireTenantSession(request);
		if (!session) return new Response('Unauthorized', { status: 401 });
		const { tenantId } = session;
		const result = await db.execute({
			sql: 'SELECT id, address, label, chains, is_default, wallet_type, created_at FROM wallets WHERE tenant_id = ? ORDER BY created_at DESC',
			args: [tenantId],
		});
		const wallets = result.rows.map(transformWalletRow);
		return new Response(JSON.stringify(wallets), {
			status: 200,
			headers: { 'Content-Type': 'application/json' },
		});
	} catch (error) {
		console.error('Failed to load wallets', error);
		return new Response(JSON.stringify({ error: true, message: 'Unable to fetch wallets' }), { status: 500 });
	}
};

export const POST: APIRoute = async ({ request }) => {
	try {
		const session = await requireTenantSession(request);
		if (!session) return new Response('Unauthorized', { status: 401 });
		const { tenantId, isDemo } = session;

		// ── Demo limit: 3 wallets max ─────────────────────────────────────
		if (isDemo) {
			const countResult = await db.execute({
				sql: `SELECT COUNT(*) as cnt FROM wallets WHERE tenant_id = ?`,
				args: [tenantId],
			});
			const current = Number((countResult.rows[0] as Record<string, unknown>)?.cnt ?? 0);
			if (current >= 3) {
				return new Response(
					JSON.stringify({
						error: true,
						code: 'DEMO_LIMIT_REACHED',
						message: 'Demo is limited to 3 wallets. Sign up free to add more.',
					}),
					{ status: 402, headers: { 'Content-Type': 'application/json' } },
				);
			}
		}

		// ── Plan limit check ──────────────────────────────────────────────
		const limitCheck = await checkWalletLimit(tenantId);
		if (!limitCheck.allowed) {
			return new Response(
				JSON.stringify({
					error: true,
					code: 'PLAN_LIMIT_REACHED',
					message: limitCheck.message,
					current: limitCheck.current,
					limit: limitCheck.limit,
					plan: limitCheck.plan.id,
				}),
				{ status: 402, headers: { 'Content-Type': 'application/json' } },
			);
		}

		const body = await request.json();
		const walletType: 'onchain' | 'custom' =
			body.walletType === 'custom' ? 'custom' : 'onchain';

		if (walletType === 'custom') {
			const label = typeof body.label === 'string' ? body.label.trim() : '';
			if (!label) {
				return responseWithError('A label is required for custom wallets.', 400);
			}
			// Address is optional for custom wallets — generate a stable placeholder if omitted.
			const rawAddress = typeof body.address === 'string' ? body.address.trim() : '';
			const address = sanitizeAddress(rawAddress) || `custom_${crypto.randomUUID().replace(/-/g, '')}`;
			const chains = normalizeChains(body.chains ?? []);

			const inserted = await db.execute({
				sql: `INSERT INTO wallets (tenant_id, address, label, chains, is_default, wallet_type)
				      VALUES (?, ?, ?, ?, 0, 'custom')
				      RETURNING id, address, label, chains, is_default, created_at, wallet_type`,
				args: [tenantId, address, label, JSON.stringify(chains)],
			});

			const wallet = transformWalletRow(inserted.rows[0]);
			return new Response(JSON.stringify(wallet), {
				status: 201,
				headers: { 'Content-Type': 'application/json' },
			});
		}

		// Demo shortcut: keys "1", "2", "3" seed pre-configured mock wallets without
		// going through address validation (which would correctly reject bare numbers).
		if (tenantId === DEMO_TENANT_ID) {
			const rawKey = String(body.address ?? '').trim();
			const demoKey = isDemoWalletAddress(rawKey) ? rawKey : (rawKey.match(/^([123])/)?.[1] ?? null);
			const demoConfig = demoKey ? DEMO_WALLET_CONFIGS[demoKey] : null;
			if (demoConfig) {
				const demoAddress = demoKey; // store as "1"/"2"/"3"
				const dupCheck = await db.execute({
					sql: `SELECT id FROM wallets WHERE tenant_id = ? AND address = ? LIMIT 1`,
					args: [tenantId, demoAddress],
				});
				if (dupCheck.rows?.length) {
					return new Response(JSON.stringify({
						error: true,
						code: 'DUPLICATE_ADDRESS',
						message: 'That demo wallet is already tracked.',
						existingWalletId: String(dupCheck.rows[0].id ?? ''),
					}), { status: 409, headers: { 'Content-Type': 'application/json' } });
				}
				const inserted = await db.execute({
					sql: `INSERT INTO wallets (tenant_id, address, label, chains, is_default, wallet_type)
					      VALUES (?, ?, ?, ?, 0, 'onchain')
					      RETURNING id, address, label, chains, is_default, created_at, wallet_type`,
					args: [tenantId, demoAddress, demoConfig.label, JSON.stringify(demoConfig.chains)],
				});
				const walletId = String(inserted.rows[0]?.id ?? '');
				if (walletId) {
					const totals = demoConfig.tokens.reduce((s, t) => s + t.valueUsd, 0);
					await db.execute({
						sql: `INSERT INTO wallet_snapshots
						      (tenant_id, wallet_id, chain, totals_usd, collateral_usd, debt_usd,
						       collateral_apy_pct, borrow_apy_pct, net_rate_pct, payload_json, captured_at)
						      VALUES (?, ?, ?, ?, 0, 0, NULL, NULL, 0, ?, to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS'))`,
						args: [tenantId, walletId, demoConfig.chain, totals, JSON.stringify(demoConfig.tokens)],
					}).catch(() => {});
				}
				const wallet = transformWalletRow(inserted.rows[0]);
				return new Response(JSON.stringify(wallet), {
					status: 201,
					headers: { 'Content-Type': 'application/json' },
				});
			}
		}

		// Standard on-chain wallet (EVM, Sui, or Bitcoin — address validation handles all)
		const address = sanitizeAddress(body.address);
		if (!address) {
			return responseWithError('A valid wallet address is required (0x… for EVM/Sui, bc1q… / bc1p… / 1… / 3… for Bitcoin, ltc1q… for Litecoin, base58 for Solana).', 400);
		}

		// Pre-check for duplicate before INSERT to give a clear, actionable message.
		const dupCheck = await db.execute({
			sql: `SELECT id FROM wallets WHERE tenant_id = ? AND address = ? LIMIT 1`,
			args: [tenantId, address],
		});
		if (dupCheck.rows?.length) {
			return new Response(JSON.stringify({
				error: true,
				code: 'DUPLICATE_ADDRESS',
				message: 'That address is already being tracked.',
				existingWalletId: String(dupCheck.rows[0].id ?? ''),
			}), { status: 409, headers: { 'Content-Type': 'application/json' } });
		}

		const label =
			typeof body.label === 'string' && body.label.trim().length ? body.label.trim() : deriveDefaultLabel(address);
		const chains = normalizeChains(body.chains ?? ['ethereum', 'polygon', 'avalanche']);
		const isDefault = body.isDefault === true ? 1 : 0;

		const inserted = await db.execute({
			sql: `INSERT INTO wallets (tenant_id, address, label, chains, is_default, wallet_type)
			      VALUES (?, ?, ?, ?, ?, 'onchain')
			      RETURNING id, address, label, chains, is_default, created_at, wallet_type`,
			args: [tenantId, address, label, JSON.stringify(chains), isDefault],
		});

		const wallet = transformWalletRow(inserted.rows[0]);
		return new Response(JSON.stringify(wallet), {
			status: 201,
			headers: { 'Content-Type': 'application/json' },
		});
	} catch (error) {
		console.error('Failed to create wallet', error);
		const msg = error instanceof Error ? error.message : String(error);
		if (msg.includes('UNIQUE') || msg.includes('unique')) {
			return responseWithError('That address is already being tracked. Edit the existing wallet instead.', 409);
		}
		return responseWithError('Unable to save wallet. Please try again.', 500);
	}
};

function responseWithError(message: string, status = 400) {
	return new Response(JSON.stringify({ error: true, message }), {
		status,
		headers: { 'Content-Type': 'application/json' },
	});
}
