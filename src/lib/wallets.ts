import type { Client } from '@libsql/client';
import { db as sharedDb } from './db';
import { DEFAULT_ERC20_CHAINS } from './constants';

export type Wallet = {
	id: string;
	userId?: string | null;
	address: string;
	label: string | null;
	chains: string[];
	isDefault?: boolean;
	createdAt: string;
};

export type WalletInput = {
	address: string;
	label?: string | null;
	chains?: string[];
	isDefault?: boolean;
};

export function deriveDefaultLabel(address: string): string {
	if (!address) return 'Wallet';
	return address.trim().slice(-5);
}

export async function getAllActiveWallets(): Promise<Wallet[]> {
	const result = await sharedDb.execute(
		`SELECT id, user_id, address, label, chains, is_default, created_at
		 FROM wallets
		 WHERE is_default = 1
		 ORDER BY created_at DESC`,
	);
	return result.rows.map(transformRow);
}

export async function upsertWallets(db: Client, wallets: WalletInput[]) {
	if (!wallets.length) return [];
	const statements = wallets.map((wallet) => ({
		sql: `INSERT INTO wallets (address, label, chains, is_default)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(address) DO UPDATE SET label = excluded.label, chains = excluded.chains, is_default = excluded.is_default
          RETURNING id, user_id, address, label, chains, is_default, created_at`,
		args: [
			wallet.address.toLowerCase(),
			wallet.label && wallet.label.trim().length ? wallet.label.trim() : deriveDefaultLabel(wallet.address),
			JSON.stringify(
				wallet.chains && wallet.chains.length ? wallet.chains : DEFAULT_ERC20_CHAINS,
			),
			wallet.isDefault ? 1 : 0,
		],
	}));

	const results = await Promise.all(statements.map((stmt) => db.execute(stmt)));
	return results.map((result) => transformRow(result.rows[0]));
}

export async function insertWallet(address: string, label?: string | null) {
	const result = await sharedDb.execute({
		sql: `INSERT INTO wallets (address, label, chains)
        VALUES (?, ?, ?)
        RETURNING id, user_id, address, label, chains, is_default, created_at`,
		args: [
			address.toLowerCase(),
			label && label.trim().length ? label.trim() : deriveDefaultLabel(address),
			JSON.stringify(DEFAULT_ERC20_CHAINS),
		],
	});
	return transformRow(result.rows[0]);
}

export async function createWallet(opts: {
	id?: string;
	address: string;
	label?: string | null;
	chains?: string[];
	isDefault?: boolean;
}) {
	const address = opts.address.toLowerCase();
	const derivedId = opts.id ?? address.slice(-5).toUpperCase();
	const derivedLabel = opts.label && opts.label.trim().length ? opts.label.trim() : deriveDefaultLabel(address);
	const chainsJson = JSON.stringify(opts.chains ?? ['ethereum', 'avalanche']);
	const isDefault = opts.isDefault ? 1 : 0;

	const result = await sharedDb.execute({
		sql: `INSERT INTO wallets (id, address, label, chains, is_default)
        VALUES (?, ?, ?, ?, ?)
        RETURNING id, user_id, address, label, chains, is_default, created_at`,
		args: [derivedId, address, derivedLabel, chainsJson, isDefault],
	});

	return transformRow(result.rows[0]);
}

export async function getWalletById(id: string): Promise<Wallet | null> {
	const result = await sharedDb.execute({
		sql: 'SELECT id, user_id, address, label, chains, is_default, created_at FROM wallets WHERE id = ? LIMIT 1',
		args: [id],
	});
	const row = result.rows[0];
	if (!row) return null;
	return transformRow(row as Record<string, any>);
}

function transformRow(row: Record<string, any>): Wallet {
	return {
		id: row.id,
		userId: row.user_id ?? null,
		address: row.address,
		label: row.label,
		chains: safeParseChains(row.chains),
		isDefault: Boolean(row.is_default),
		createdAt: row.created_at,
	};
}

function safeParseChains(value: unknown) {
	if (typeof value !== 'string') return [...DEFAULT_ERC20_CHAINS];
	try {
		const parsed = JSON.parse(value);
		if (!Array.isArray(parsed)) return [...DEFAULT_ERC20_CHAINS];
		return parsed.length ? parsed : [...DEFAULT_ERC20_CHAINS];
	} catch {
		return [...DEFAULT_ERC20_CHAINS];
	}
}
