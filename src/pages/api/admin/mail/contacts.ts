/**
 * GET /api/admin/mail/contacts?mailbox=admin@susufinance.com
 *   → the addresses this mailbox has corresponded with, most-used first
 *
 * There is no contacts table and deliberately so. A hand-maintained address book goes
 * stale the day it is created and gets bypassed the day after. Everyone this mailbox
 * has ever written to or heard from is already recorded in mail_messages, so the
 * address book is a query, not a thing to keep up to date.
 *
 * Scoped to one mailbox: admin@ and a second mailbox are different people's correspondence,
 * and one should not complete from the other's history.
 */

import type { APIRoute } from 'astro';
import { requireAdminSession } from '@/lib/adminGuard';
import { db } from '@/lib/db';
import { findMailboxForAdmin } from '@/lib/mailboxes';

export const prerender = false;

/** Enough to autocomplete from; far past what a person actually corresponds with. */
const MAX_CONTACTS = 300;

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' },
	});
}

/** 'Ama Mensah <ama@example.com>, ops@x.com' → ['ama@example.com', 'ops@x.com'] */
function splitAddresses(raw: string): Array<{ address: string; name: string | null }> {
	return String(raw ?? '')
		.split(',')
		.map((part) => part.trim())
		.filter(Boolean)
		.map((part) => {
			const angled = part.match(/^(.*?)<([^>]+)>$/);
			if (angled) {
				const name = angled[1].trim().replace(/^["']|["']$/g, '');
				return { address: angled[2].trim().toLowerCase(), name: name || null };
			}
			return { address: part.toLowerCase(), name: null };
		})
		.filter((a) => a.address.includes('@'));
}

export const GET: APIRoute = async ({ request }) => {
	let who;
	try { who = await requireAdminSession(request); }
	catch (resp) { return resp instanceof Response ? resp : json({ ok: false, error: 'Unauthorized' }, 401); }

	const address = new URL(request.url).searchParams.get('mailbox') ?? '';
	const box = findMailboxForAdmin(address, who);
	if (!box) return json({ ok: false, error: 'Unknown mailbox' }, 404);

	const r = await db.execute({
		sql: `SELECT direction, from_addr, from_name, to_addrs, cc_addrs
		      FROM mail_messages
		      WHERE mailbox = ?
		      ORDER BY COALESCE(sent_at, fetched_at) DESC
		      LIMIT 2000`,
		args: [box.address],
	});

	// Rank by how often someone appears: the people he actually writes to should be the
	// first completions, not whoever happens to be alphabetically first.
	const seen = new Map<string, { address: string; name: string | null; count: number }>();
	const add = (address: string, name: string | null) => {
		if (!address || address === box.address) return; // never complete to yourself
		const existing = seen.get(address);
		if (existing) {
			existing.count++;
			// Keep the first real name found — later messages often carry none.
			if (!existing.name && name) existing.name = name;
		} else {
			seen.set(address, { address, name, count: 1 });
		}
	};

	for (const row of r.rows as Record<string, unknown>[]) {
		if (row.direction === 'in') {
			add(String(row.from_addr ?? '').toLowerCase(), row.from_name ? String(row.from_name) : null);
		} else {
			for (const a of splitAddresses(String(row.to_addrs ?? ''))) add(a.address, a.name);
		}
		for (const a of splitAddresses(String(row.cc_addrs ?? ''))) add(a.address, a.name);
	}

	const contacts = [...seen.values()]
		.sort((a, b) => b.count - a.count || a.address.localeCompare(b.address))
		.slice(0, MAX_CONTACTS);

	return json({ ok: true, mailbox: box.address, contacts });
};
