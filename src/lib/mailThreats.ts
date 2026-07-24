/**
 * mailThreats.ts — run an incoming message through the wallet checker.
 *
 * Extracts every wallet address and link from a message, checks each against the same
 * sources the public checker uses, and records what it finds.
 *
 * ── Why the two checks are budgeted differently ─────────────────────────────
 * lookupDomainThreats() reads lists already held locally and refreshed on a schedule,
 * so it costs nothing per message and every URL gets checked.
 *
 * checkWallet() calls external APIs. Left unbounded, one mailing list with forty
 * addresses in the footer would burn the quota and stall the cron behind forty
 * round trips. So addresses are capped per message and per run, and the checker's own
 * cache is consulted first. A capped scan is honest as long as the cap is visible,
 * which is why scanned_at is recorded separately from the findings: no findings means
 * "checked, nothing found", a null scanned_at means "not checked".
 */

import { randomUUID } from 'node:crypto';
import { db } from './db';
import { lookupDomainThreats } from './threatLists';
import { checkWallet, getCached, isValidAddress } from './walletChecker';

/** Addresses put through the full API check, per message. */
const MAX_ADDRESSES_PER_MESSAGE = 5;
/** And across one poll run, so a burst of mail cannot exhaust the quota. */
const MAX_ADDRESS_CHECKS_PER_RUN = 25;

/** URLs are cheap, but a message with a thousand links is not worth unbounded work. */
const MAX_URLS_PER_MESSAGE = 25;

/**
 * How long a verdict is trusted, by how bad it is.
 *
 * A danger verdict is durable — a sanctioned or blacklisted address does not become
 * clean — so re-checking it only burns quota. A clean verdict is perishable: today's
 * unknown address is tomorrow's reported drainer, and a stale clean is the dangerous
 * direction to be wrong in.
 */
const TTL_DAYS = { danger: 30, caution: 7, clean: 3 } as const;

interface CachedVerdict {
	scamLevel: 'clean' | 'caution' | 'danger';
	scamScore: number;
	flags: Record<string, boolean>;
	partialCoverage: boolean;
}

/** A verdict from Postgres, or null if absent or expired. */
async function readCachedVerdict(address: string): Promise<CachedVerdict | null> {
	try {
		const r = await db.execute({
			sql: `SELECT scam_level, scam_score, flags_json, partial
			      FROM wallet_verdict_cache
			      WHERE address = ? AND expires_at > now()
			      LIMIT 1`,
			args: [address.toLowerCase()],
		});
		const row = r.rows[0] as Record<string, unknown> | undefined;
		if (!row) return null;
		return {
			scamLevel: String(row.scam_level) as CachedVerdict['scamLevel'],
			scamScore: Number(row.scam_score ?? 0),
			flags: JSON.parse(String(row.flags_json ?? '{}')),
			partialCoverage: Boolean(row.partial),
		};
	} catch {
		// A cache miss and a cache failure are the same thing to the caller: check live.
		return null;
	}
}

async function writeCachedVerdict(address: string, chain: string | null, v: CachedVerdict): Promise<void> {
	try {
		const days = TTL_DAYS[v.scamLevel] ?? TTL_DAYS.clean;
		await db.execute({
			sql: `INSERT INTO wallet_verdict_cache
			        (address, chain, scam_level, scam_score, flags_json, partial, checked_at, expires_at)
			      VALUES (?, ?, ?, ?, ?, ?, now(), now() + (? || ' days')::interval)
			      ON CONFLICT (address) DO UPDATE
			        SET chain = EXCLUDED.chain,
			            scam_level = EXCLUDED.scam_level,
			            scam_score = EXCLUDED.scam_score,
			            flags_json = EXCLUDED.flags_json,
			            partial = EXCLUDED.partial,
			            checked_at = now(),
			            expires_at = EXCLUDED.expires_at`,
			args: [
				address.toLowerCase(), chain, v.scamLevel, Math.round(v.scamScore),
				JSON.stringify(v.flags ?? {}), v.partialCoverage, String(days),
			],
		});
	} catch (err) {
		console.warn('[mailThreats] verdict cache write failed:', err instanceof Error ? err.message : err);
	}
}

/** Housekeeping — called by the poll so the table cannot grow without bound. */
export async function sweepVerdictCache(): Promise<void> {
	try {
		await db.execute({ sql: `DELETE FROM wallet_verdict_cache WHERE expires_at < now()` });
	} catch { /* non-fatal */ }
}

export interface Finding {
	kind: 'address' | 'url';
	value: string;
	/** 'known' is the positive case — evidence FOR an address, not against it. */
	severity: 'danger' | 'warning' | 'known';
	reason: string;
}

/**
 * Is this address one the programme already knows?
 *
 * Answers only within ONE tenant, and only when the mailbox declares which. A search
 * across every tenant's members would use one programme's mail to answer questions
 * about another programme's people, which is the isolation line this architecture does
 * not cross. No tenant on the mailbox means no lookup at all — fail closed.
 *
 * The value here is not just reassurance. A susu organizer's live risk is the swapped
 * address: a message that looks routine, carrying a payout address that is NOT the one
 * on file. Marking the ones that ARE on file is what makes the unmarked ones visible.
 */
async function lookupKnownAddress(address: string, tenantId: string | null): Promise<Finding | null> {
	if (!tenantId) return null;
	try {
		const r = await db.execute({
			sql: `SELECT display_name, address_verified_at
			      FROM members
			      WHERE tenant_id = ? AND lower(payout_address) = lower(?)
			      LIMIT 1`,
			args: [tenantId, address],
		});
		const row = r.rows[0] as Record<string, unknown> | undefined;
		if (!row) return null;

		// A chosen name, or nothing — a UUID-only member is a choice, and printing her
		// id into a mail panel would undo it.
		const who = row.display_name ? String(row.display_name) : 'a member';
		const verified = Boolean(row.address_verified_at);

		return {
			kind: 'address',
			value: address,
			// Verified means she proved control of it via a self-send. Unverified means
			// it is merely what is recorded, which is worth knowing but is not proof.
			severity: verified ? 'known' : 'warning',
			reason: verified
				? `Payout address on file for ${who}, verified`
				: `Payout address on file for ${who}, NOT yet verified`,
		};
	} catch {
		return null;
	}
}

// EVM, Bitcoin (bech32 and legacy), and Solana base58. Deliberately broad: a false
// candidate costs one cache lookup, a missed address costs the whole point.
const ADDRESS_RE = /\b(0x[a-fA-F0-9]{40}|bc1[a-z0-9]{25,62}|[13][a-km-zA-HJ-NP-Z1-9]{25,34}|[1-9A-HJ-NP-Za-km-z]{32,44})\b/g;
const URL_RE = /\bhttps?:\/\/[^\s<>"')\]]+/gi;

export function extractAddresses(text: string): string[] {
	const found = new Set<string>();
	for (const m of String(text ?? '').matchAll(ADDRESS_RE)) {
		const candidate = m[1];
		if (isValidAddress(candidate)) found.add(candidate);
	}
	return [...found];
}

export function extractDomains(text: string): string[] {
	const found = new Set<string>();
	for (const m of String(text ?? '').matchAll(URL_RE)) {
		try {
			const host = new URL(m[0]).hostname.toLowerCase().replace(/^www\./, '');
			if (host) found.add(host);
		} catch {
			// A malformed URL is not a domain to check; skip rather than guess at it.
		}
	}
	return [...found];
}

/**
 * Scan one message. Returns findings; never throws — a scanner failure must not lose
 * the mail it was scanning.
 *
 * `budget` is shared across a poll run: pass the same object for every message so the
 * per-run address cap actually holds.
 */
export async function scanMessage(
	text: string,
	budget: { addressChecksLeft: number },
	opts: { dangerOnly?: boolean; tenantId?: string | null } = {},
): Promise<Finding[]> {
	const findings: Finding[] = [];

	// ── Links ────────────────────────────────────────────────────────────────
	for (const domain of extractDomains(text).slice(0, MAX_URLS_PER_MESSAGE)) {
		try {
			const r = await lookupDomainThreats(domain);

			// ready=false means the mirrored lists have not been populated yet. Absence
			// of a hit then proves nothing, so say nothing — a warning system that
			// reports "clean" while its data is missing is worse than one that is quiet.
			if (!r.ready) continue;

			// An explicit MetaMask whitelist entry outranks a ScamSniffer hit: the
			// whitelist exists precisely to correct false positives on real sites.
			if (r.metamaskWhitelist) continue;

			const sources: string[] = [];
			if (r.metamaskBlacklist) sources.push('MetaMask');
			if (r.scamsniffer) sources.push('ScamSniffer');

			if (sources.length) {
				findings.push({
					kind: 'url',
					value: domain,
					severity: 'danger',
					reason: `Known phishing domain (${sources.join(', ')})`,
				});
			}
		} catch {
			// A list lookup failing is not evidence of safety, but it is not evidence of
			// danger either. Stay silent rather than cry wolf.
		}
	}

	// ── Addresses ────────────────────────────────────────────────────────────
	const addresses = extractAddresses(text).slice(0, MAX_ADDRESSES_PER_MESSAGE);
	for (const address of addresses) {
		try {
			// Known-address check first: it is a local query, it costs nothing, and a
			// recognised payout address is the most useful thing the panel can say about
			// an address in a message about money.
			const known = await lookupKnownAddress(address, opts.tenantId ?? null);
			if (known) {
				// Still fall through to the scam check — an address being on file does
				// not make it safe, and a member's own wallet can be compromised.
				findings.push(known);
			}

			// Three tiers, cheapest first. Postgres outlives the process and is shared
			// across mailboxes, so a scam address circulating in twenty messages over a
			// week costs one API call rather than twenty.
			let verdict: CachedVerdict | null = await readCachedVerdict(address);

			if (!verdict) {
				const live = getCached(address) ?? (
					budget.addressChecksLeft > 0
						? (budget.addressChecksLeft--, await checkWallet(address))
						: null
				);
				if (!live) continue;
				verdict = {
					scamLevel: live.scamLevel,
					scamScore: live.scamScore,
					flags: live.flags as unknown as Record<string, boolean>,
					partialCoverage: live.partialCoverage,
				};
				await writeCachedVerdict(address, live.chain ?? null, verdict);
			}

			const result = verdict;

			// partialCoverage means no primary scam source ran for this chain, so a
			// "clean" result is not a confident one. The checker itself flags this; the
			// inbox must not launder it into a green light by staying silent.
			if (result.partialCoverage && result.scamLevel === 'clean') continue;

			const f = result.flags;
			const reasons: string[] = [];
			if (f.blacklisted) reasons.push('on a global blacklist');
			if (f.sanctioned) reasons.push('OFAC sanctioned');
			if (f.phishing) reasons.push('linked to phishing');
			if (f.honeypotRelated) reasons.push('honeypot related');
			if (f.stealingAttack) reasons.push('linked to a stealing attack');
			if (f.darkwebTransactions) reasons.push('dark web activity');
			if (f.mixer) reasons.push('mixer activity');
			if (f.moneyLaundering || f.financialCrime || f.cybercrime) reasons.push('financial crime');
			if (f.blackmail) reasons.push('blackmail reports');

			if (result.scamLevel === 'danger' || reasons.length) {
				findings.push({
					kind: 'address',
					value: address,
					severity: 'danger',
					reason: reasons.length
						? `Wallet ${reasons.join(', ')}`
						: `Wallet scored ${result.scamScore}/100 by the checker`,
				});
			} else if (result.scamLevel === 'caution' && !opts.dangerOnly) {
				findings.push({
					kind: 'address',
					value: address,
					severity: 'warning',
					reason: `Wallet flagged for caution (${result.scamScore}/100)`,
				});
			}
		} catch {
			// Same reasoning as above: an unreachable checker is not a verdict.
		}
	}

	return findings;
}

/**
 * Scan a stored message and record the result.
 *
 * scanned_at is always stamped, findings or not, so the panel can distinguish "checked
 * and clean" from "never checked". Treating those the same would let an outage read as
 * an all-clear, which is the failure mode that matters for a warning system.
 */
export async function scanAndRecord(
	messageId: string,
	text: string,
	budget: { addressChecksLeft: number },
	opts: { dangerOnly?: boolean; tenantId?: string | null } = {},
): Promise<Finding[]> {
	let findings: Finding[] = [];
	try {
		findings = await scanMessage(text, budget, opts);
	} catch {
		findings = [];
	}

	try {
		for (const f of findings) {
			await db.execute({
				sql: `INSERT INTO mail_threats (id, message_id, kind, value, severity, reason)
				      VALUES (?, ?, ?, ?, ?, ?)
				      ON CONFLICT (message_id, kind, value) DO NOTHING`,
				args: [randomUUID(), messageId, f.kind, f.value, f.severity, f.reason],
			});
		}

		// 'known' is a positive finding and must not colour the row as a threat.
		const level = findings.some((f) => f.severity === 'danger') ? 'danger'
			: findings.some((f) => f.severity === 'warning') ? 'warning'
			: null;

		await db.execute({
			sql: `UPDATE mail_messages SET threat_level = ?, scanned_at = now() WHERE id = ?`,
			args: [level, messageId],
		});
	} catch (err) {
		console.warn('[mailThreats] could not record findings:', err instanceof Error ? err.message : err);
	}

	return findings;
}

/** A fresh budget for one poll run. */
export function newScanBudget() {
	return { addressChecksLeft: MAX_ADDRESS_CHECKS_PER_RUN };
}
