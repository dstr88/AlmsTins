import type { APIRoute } from 'astro';
import Anthropic from '@anthropic-ai/sdk';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { getActivePlan } from '@/lib/subscriptions';

export const prerender = false;

interface TxSummary {
	idx:         number;
	id:          string;
	dir:         string;
	sym:         string;
	amount:      number;
	usd:         number | null;
	kind:        string;
	description: string;
	source:      string;
	ts:          string;
	notes:       string;
	category:    string;
}

export type TriageClass =
	| 'annotated'
	| 'obvious_purchase'
	| 'obvious_income'
	| 'obvious_own_wallet'
	| 'obvious_sale'
	| 'needs_review';

interface TriageRow {
	idx:            number;
	id:             string;
	classification: TriageClass;
	reason:         string;
}

const BATCH_SIZE = 60;

async function triageBatch(
	anthropic: Anthropic,
	batch: TxSummary[],
): Promise<TriageRow[]> {
	const lines = batch.map(t =>
		`[${t.idx}] ${t.dir.toUpperCase()} ${t.sym} ${t.amount} (${t.usd != null ? '$' + t.usd.toFixed(2) : 'no USD'}) | kind:${t.kind || '—'} | desc:"${t.description}" | src:${t.source} | ${t.ts.slice(0, 10)} | notes:"${t.notes}" | category:"${t.category}"`
	).join('\n');

	const msg = await anthropic.messages.create({
		model: 'claude-haiku-4-5-20251001',
		max_tokens: 2048,
		messages: [{
			role: 'user',
			content: `You are a crypto tax analyst triaging unresolved transactions. Classify each one.

Classifications:
- annotated       : already has a note or category set — user has dealt with this
- obvious_purchase : clearly a buy/acquisition (buy order, Bitcoin Purchase, etc.)
- obvious_income   : clearly income (staking reward, earn program, interest, referral, cashback)
- obvious_own_wallet: clearly a self-transfer (bridge, own wallet mention, wrapped token mint)
- obvious_sale     : clearly a disposal/sell
- needs_review     : genuinely ambiguous — requires human judgment

Respond ONLY with a JSON array. No explanation, no markdown.
Format: [{"idx":<number>,"classification":"<class>","reason":"<one short sentence>"}]

Transactions:
${lines}`,
		}],
	});

	const text = msg.content[0].type === 'text' ? msg.content[0].text.trim() : '[]';
	const json = text.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/i, '').trim();
	const rows: Array<{ idx: number; classification: string; reason: string }> = JSON.parse(json);

	return rows.map(r => ({
		idx:            r.idx,
		id:             batch.find(t => t.idx === r.idx)?.id ?? '',
		classification: (r.classification as TriageClass) ?? 'needs_review',
		reason:         r.reason ?? '',
	}));
}

export const POST: APIRoute = async ({ request }) => {
	const session = await requireTenantSession(request);
	if (!session) return new Response('Unauthorized', { status: 401 });
	const { tenantId } = session;

	const plan = await getActivePlan(tenantId);
	if (plan.id === 'free') {
		return new Response(JSON.stringify({
			error: 'AI Triage is available on any paid plan. Upgrade at /dashboard/billing.',
			planRequired: 'paid',
		}), { status: 403, headers: { 'Content-Type': 'application/json' } });
	}

	const body = await request.json();
	const transactions: any[] = Array.isArray(body?.transactions) ? body.transactions : [];

	if (transactions.length === 0) {
		return new Response(JSON.stringify({ error: 'No transactions provided' }), { status: 400 });
	}

	if (!process.env.ANTHROPIC_API_KEY) {
		return new Response(JSON.stringify({ error: 'AI triage is not configured.' }), { status: 503 });
	}

	const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

	// Build compact summaries
	const summaries: TxSummary[] = transactions.map((t, i) => ({
		idx:         i,
		id:          String(t.id ?? ''),
		dir:         String(t.direction ?? ''),
		sym:         String(t.asset_symbol ?? ''),
		amount:      Math.abs(Number(t.amount ?? 0)),
		usd:         t.native_usd != null ? Number(t.native_usd) : null,
		kind:        String(t.kind ?? ''),
		description: String(t.description ?? '').slice(0, 100),
		source:      String(t.source ?? ''),
		ts:          String(t.timestamp_utc ?? ''),
		notes:       String(t.notes ?? ''),
		category:    String(t.category ?? ''),
	}));

	// Process in batches to stay within context limits
	const results: TriageRow[] = [];
	for (let i = 0; i < summaries.length; i += BATCH_SIZE) {
		const batch = summaries.slice(i, i + BATCH_SIZE);
		try {
			const batchResults = await triageBatch(anthropic, batch);
			results.push(...batchResults);
		} catch (err) {
			console.error('[ai-triage] batch failed', err);
			// Mark the whole batch as needs_review on failure
			batch.forEach(t => results.push({ idx: t.idx, id: t.id, classification: 'needs_review', reason: 'Triage failed for this batch' }));
		}
	}

	// Group by classification
	const groups: Record<TriageClass, TriageRow[]> = {
		annotated:          [],
		obvious_purchase:   [],
		obvious_income:     [],
		obvious_own_wallet: [],
		obvious_sale:       [],
		needs_review:       [],
	};
	for (const r of results) {
		const key = (groups[r.classification] ? r.classification : 'needs_review') as TriageClass;
		groups[key].push(r);
	}

	return new Response(JSON.stringify({ ok: true, total: results.length, groups }), {
		status: 200,
		headers: { 'Content-Type': 'application/json' },
	});
};
