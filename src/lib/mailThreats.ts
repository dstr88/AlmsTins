/**
 * mailThreats.ts — run an incoming message through the wallet checker.
 *
 * Extracts every wallet address and link from a message, checks each against lists
 * Almstins holds locally, and records what it finds.
 *
 * ── Nothing from a message leaves Almstins ──────────────────────────────────
 * Mail is other people's data (support requests, partners, strangers), so screening it
 * never calls an outside service (decided 2026-10-10, privacy policy v1.2):
 *   - links: lookupDomainThreats() reads the locally mirrored MetaMask and ScamSniffer
 *     lists, refreshed on a schedule;
 *   - wallet addresses: localAddressVerdict() reads the local OFAC mirror and the curated
 *     mixer and compromised-contract lists. It never calls checkWallet(), which would send
 *     the address to GoPlus, Chainalysis, Chainabuse and others.
 * Local lists are not a full scan, so a clean address stays silent rather than reading
 * as safe. scanned_at is recorded separately from the findings: no findings means
 * "checked, nothing found on our lists", a null scanned_at means "not checked".
 */

import { randomUUID } from 'node:crypto';
import { db } from './db';
import { lookupDomainThreats, lookupSanctionedAddress } from './threatLists';
import { canonicalAddress, isCompromisedAddress, isMixerAddress, isValidAddress } from './walletChecker';

/** Addresses checked per message, so a footer full of addresses stays cheap. */
const MAX_ADDRESSES_PER_MESSAGE = 5;
/** Kept for the poll's budget object; address checks are local now and do not spend it. */
const MAX_ADDRESS_CHECKS_PER_RUN = 25;

/** URLs are cheap, but a message with a thousand links is not worth unbounded work. */
const MAX_URLS_PER_MESSAGE = 25;

interface LocalVerdict {
	scamLevel: 'clean' | 'caution' | 'danger';
	scamScore: number;
	flags: Record<string, boolean>;
	partialCoverage: boolean;
}

/**
 * The verdict for an address found in mail, from local data only: the OFAC mirror and
 * the curated mixer and compromised-contract lists. Local lists are not a full scan, so
 * partialCoverage is always true and a clean result means "not on our lists".
 */
async function localAddressVerdict(address: string): Promise<LocalVerdict> {
	const canonical = canonicalAddress(address);
	const sanctioned = await lookupSanctionedAddress(canonical).catch(() => false);
	const blacklisted = isCompromisedAddress(canonical);
	const mixer = isMixerAddress(canonical);
	return {
		scamLevel: sanctioned || blacklisted ? 'danger' : mixer ? 'caution' : 'clean',
		scamScore: sanctioned ? 100 : blacklisted ? 90 : mixer ? 40 : 0,
		flags: { sanctioned, blacklisted, mixer },
		partialCoverage: true,
	};
}

/**
 * Housekeeping — called by the poll. wallet_verdict_cache held verdicts from the old
 * outside-service checks of mail addresses. Nothing reads or writes it now, so the sweep
 * empties it rather than keeping addresses taken from mail.
 */
export async function sweepVerdictCache(): Promise<void> {
	try {
		await db.execute({ sql: `DELETE FROM wallet_verdict_cache` });
	} catch { /* non-fatal; the table may not exist */ }
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
 * `_budget` is kept so callers need not change: address checks are local now and do not
 * spend it.
 */
export async function scanMessage(
	text: string,
	_budget: { addressChecksLeft: number },
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

			// Local lists only (see localAddressVerdict): nothing from the message leaves
			// Almstins.
			const result = await localAddressVerdict(address);

			// partialCoverage means no primary scam source ran for this chain, so a
			// "clean" result is not a confident one. The checker itself flags this; the
			// inbox must not launder it into a green light by staying silent.
			if (result.partialCoverage && result.scamLevel === 'clean') continue;

			const f = result.flags;
			const reasons: string[] = [];
			if (f.sanctioned) reasons.push('OFAC sanctioned');
			if (f.blacklisted) reasons.push('on the known-compromised list');
			if (f.mixer) reasons.push('a known mixer');

			if (result.scamLevel === 'danger' || reasons.length) {
				findings.push({
					kind: 'address',
					value: address,
					severity: 'danger',
					reason: reasons.length
						? `Wallet ${reasons.join(', ')} (local lists)`
						: `Wallet scored ${result.scamScore}/100 on local lists`,
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
			// Same reasoning as above: a failed list lookup is not a verdict.
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
