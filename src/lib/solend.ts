/**
 * solend.ts — read Solend (now "Save") lending positions for a wallet,
 * directly from on-chain accounts. No SDK dependency.
 *
 * Why no SDK: @solendprotocol/solend-sdk pulls ~540 packages (30 critical/high
 * vulns) and fails to import under our Node/SSR setup (rpc-websockets exports
 * break against its web3.js version). We only need to read an obligation and a
 * couple of reserve fields, so we parse the account buffers ourselves.
 *
 * Account layouts (Solend program So1endDq2YkqhipRh3WViPa8hdiSpxWy6z3Z6tMCpAo):
 *
 *   Obligation
 *     0   u8        version
 *     1   u64+u8    lastUpdate (slot + stale)            (9)
 *     10  pubkey    lendingMarket                        (32)
 *     42  pubkey    owner                                (32)   <- filter target
 *     74  u128      depositedValue (WAD)                 (16)
 *     90  u128      borrowedValue (WAD)                  (16)
 *     106 u128      allowedBorrowValue (WAD)             (16)
 *     122 u128      unhealthyBorrowValue (WAD)           (16)
 *     138 u8        depositsLen
 *     139 u8        borrowsLen
 *     140 ...       dataFlat: deposits[56] then borrows[80]
 *
 *   ObligationCollateral (deposit, 56 bytes)
 *     +0  pubkey    depositReserve                       (32)
 *     +32 u64       depositedAmount (cTokens)            (8)
 *     +40 u128      marketValue (WAD, USD at last refresh)(16)
 *
 *   Reserve — only the stable leading fields are read (offsets here are
 *   version-independent; later fields shift between Solend versions):
 *     0   u8        version
 *     1   u64+u8    lastUpdate                           (9)
 *     10  pubkey    lendingMarket                        (32)
 *     42  pubkey    liquidity.mintPubkey                 (32)   <- underlying mint
 *     74  u8        liquidity.mintDecimals               (1)
 *
 * The deposited amount is in collateral tokens (cTokens). For supplies, the
 * cToken:underlying ratio starts at 1:1 and drifts slightly above as interest
 * accrues, so amount/10^decimals slightly under-states the redeemable
 * underlying. We surface the on-chain marketValue (USD) alongside as a
 * cross-check. (A future refinement can parse the reserve exchange rate for an
 * exact underlying figure.)
 */

const SOLEND_PROGRAM = 'So1endDq2YkqhipRh3WViPa8hdiSpxWy6z3Z6tMCpAo';
const OBLIGATION_OWNER_OFFSET = 42;
const WAD = 1e18;

const PUBLIC_SOLANA_RPC = 'https://api.mainnet-beta.solana.com';

// Minimal known-mint → symbol map (extend as needed). Falls back to a short
// address prefix when unknown.
const KNOWN_MINTS: Record<string, string> = {
	HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3: 'PYTH',
	So11111111111111111111111111111111111111112: 'SOL',
	EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: 'USDC',
	Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: 'USDT',
};

export interface SolendPosition {
	protocol: 'Solend';
	mint: string;
	symbol: string;
	/** Deposited collateral-token amount (≈ underlying; see note above). */
	amount: number;
	/** On-chain USD value at the obligation's last refresh (cross-check). */
	onchainMarketValueUsd: number;
	side: 'supply' | 'borrow';
}

// ── base58 (no dependency) ──────────────────────────────────────────────────
const B58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function base58Encode(bytes: Uint8Array): string {
	let zeros = 0;
	while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
	const digits: number[] = [];
	for (let i = zeros; i < bytes.length; i++) {
		let carry = bytes[i];
		for (let j = 0; j < digits.length; j++) {
			carry += digits[j] << 8;
			digits[j] = carry % 58;
			carry = (carry / 58) | 0;
		}
		while (carry > 0) {
			digits.push(carry % 58);
			carry = (carry / 58) | 0;
		}
	}
	let out = '1'.repeat(zeros);
	for (let i = digits.length - 1; i >= 0; i--) out += B58_ALPHABET[digits[i]];
	return out;
}

// ── buffer readers ──────────────────────────────────────────────────────────
function readPubkey(buf: Buffer, offset: number): string {
	return base58Encode(buf.subarray(offset, offset + 32));
}
function readU64LE(buf: Buffer, offset: number): bigint {
	return buf.readBigUInt64LE(offset);
}
function readU128LE(buf: Buffer, offset: number): bigint {
	const lo = buf.readBigUInt64LE(offset);
	const hi = buf.readBigUInt64LE(offset + 8);
	return lo + (hi << 64n);
}

// ── RPC ─────────────────────────────────────────────────────────────────────
function rpcUrl(override?: string): string {
	return (
		override ||
		process.env.SOLANA_RPC_URL ||
		(import.meta as { env?: Record<string, string | undefined> }).env?.SOLANA_RPC_URL ||
		PUBLIC_SOLANA_RPC
	);
}

async function solanaRpc<T = unknown>(
	method: string,
	params: unknown[],
	url: string,
): Promise<T | null> {
	for (let attempt = 0; attempt < 2; attempt++) {
		try {
			const res = await fetch(url, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
			});
			if (!res.ok) {
				if (res.status === 429 && attempt === 0) {
					await new Promise((r) => setTimeout(r, 400));
					continue;
				}
				return null;
			}
			const json = (await res.json()) as { result?: T; error?: { message?: string } };
			if (json?.error) {
				if (/rate|too many/i.test(json.error.message ?? '') && attempt === 0) {
					await new Promise((r) => setTimeout(r, 400));
					continue;
				}
				return null;
			}
			return json?.result ?? null;
		} catch {
			if (attempt === 0) {
				await new Promise((r) => setTimeout(r, 400));
				continue;
			}
			return null;
		}
	}
	return null;
}

type AccountResult = { account?: { data?: [string, string] } };
type ProgramAccount = { pubkey: string; account: { data: [string, string] } };

function decodeData(data?: [string, string]): Buffer | null {
	if (!data || data[1] !== 'base64') return null;
	return Buffer.from(data[0], 'base64');
}

// ── obligation parsing ──────────────────────────────────────────────────────
interface ParsedDeposit {
	depositReserve: string;
	depositedAmount: bigint; // cTokens (raw)
	marketValueUsd: number; // from WAD
}

function parseObligationDeposits(buf: Buffer): ParsedDeposit[] {
	if (buf.length < 140) return [];
	const depositsLen = buf.readUInt8(138);
	const deposits: ParsedDeposit[] = [];
	let off = 140;
	for (let i = 0; i < depositsLen; i++) {
		if (off + 56 > buf.length) break;
		deposits.push({
			depositReserve: readPubkey(buf, off),
			depositedAmount: readU64LE(buf, off + 32),
			marketValueUsd: Number(readU128LE(buf, off + 40)) / WAD,
		});
		off += 56;
	}
	return deposits;
}

// Reserve: read only stable leading fields (underlying mint + decimals).
function parseReserveMint(buf: Buffer): { mint: string; decimals: number } | null {
	if (buf.length < 75) return null;
	return { mint: readPubkey(buf, 42), decimals: buf.readUInt8(74) };
}

function symbolFor(mint: string): string {
	return KNOWN_MINTS[mint] ?? `${mint.slice(0, 4)}…${mint.slice(-4)}`;
}

/**
 * Returns the Solend supply positions for a wallet. Empty array on any failure
 * (no obligation, RPC down, parse miss) — callers render an empty DeFi tin.
 */
export async function getSolendPositions(
	walletAddress: string,
	rpcOverride?: string,
): Promise<SolendPosition[]> {
	const url = rpcUrl(rpcOverride);

	const obligations = await solanaRpc<ProgramAccount[]>(
		'getProgramAccounts',
		[
			SOLEND_PROGRAM,
			{
				encoding: 'base64',
				filters: [{ memcmp: { offset: OBLIGATION_OWNER_OFFSET, bytes: walletAddress } }],
			},
		],
		url,
	);
	if (!Array.isArray(obligations) || obligations.length === 0) return [];

	// Collect deposits across all obligations owned by the wallet.
	const deposits: ParsedDeposit[] = [];
	for (const ob of obligations) {
		const buf = decodeData(ob.account?.data);
		if (buf) deposits.push(...parseObligationDeposits(buf));
	}
	if (deposits.length === 0) return [];

	// Resolve each unique reserve → underlying mint + decimals.
	const reserveIds = [...new Set(deposits.map((d) => d.depositReserve))];
	const reserveInfo = new Map<string, { mint: string; decimals: number }>();
	await Promise.all(
		reserveIds.map(async (reserve) => {
			const res = await solanaRpc<AccountResult>(
				'getAccountInfo',
				[reserve, { encoding: 'base64' }],
				url,
			);
			const buf = decodeData(res?.account?.data);
			const parsed = buf ? parseReserveMint(buf) : null;
			if (parsed) reserveInfo.set(reserve, parsed);
		}),
	);

	const positions: SolendPosition[] = [];
	for (const d of deposits) {
		const info = reserveInfo.get(d.depositReserve);
		if (!info) continue;
		const amount = Number(d.depositedAmount) / 10 ** info.decimals;
		if (amount <= 0) continue;
		positions.push({
			protocol: 'Solend',
			mint: info.mint,
			symbol: symbolFor(info.mint),
			amount,
			onchainMarketValueUsd: d.marketValueUsd,
			side: 'supply',
		});
	}
	return positions;
}
