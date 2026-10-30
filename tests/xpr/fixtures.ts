/**
 * Recorded-shape answers of the public XPR Network servers (proton.eosusa.io, 2026-10-30), with
 * invented account names and amounts, and a fake `fetch` that answers from a table. No network.
 */

import { XPR_CHAIN_ID, type FetchLike } from '@/lib/xpr/client';

export const NOW = Date.parse('2026-10-30T16:30:00.000Z');
export const now = () => NOW;

export const ALICE = 'testalice1';
export const BOB = 'testbob2';
export const CAROL = 'testcarol3';
export const TXID = (n: number) => n.toString(16).padStart(2, '0').repeat(32);

/** /v1/chain/get_info */
export const getInfo = (over: Record<string, unknown> = {}) => ({
	server_version: '04774eb7',
	chain_id: XPR_CHAIN_ID,
	head_block_num: 411372941,
	last_irreversible_block_num: 411372616,
	head_block_time: '2026-10-30T16:29:58.500',
	head_block_producer: 'testproducer',
	server_version_string: 'v5.0.0',
	...over,
});

/** /v2/health */
export const health = (over: { chain_id?: string } = {}) => ({
	version: '3.5.0-3',
	host: 'hyperion.test',
	health: [
		{ service: 'RabbitMq', status: 'OK', service_data: null },
		{ service: 'NodeosRPC', status: 'OK', service_data: { head_block_num: 411372938, chain_id: over.chain_id ?? XPR_CHAIN_ID } },
		{ service: 'Elasticsearch', status: 'OK', service_data: { last_indexed_block: 411372941 } },
	],
});

/** /v2/state/get_tokens */
export const tokens = (list: Array<{ symbol: string; contract: string; amount: number; precision?: number }>, indexed = '2026-10-30T16:29:59.500') => ({
	account: ALICE,
	tokens: list.map((t) => ({ precision: 4, ...t })),
	query_time_ms: 1.7,
	last_indexed_block: 411373160,
	last_indexed_block_time: indexed,
});

/** One /v2/history/get_actions action, shaped as the server answers it. */
export function action(o: {
	seq: number;
	at: string;
	from: string;
	to: string;
	quantity: string;
	contract?: string;
	memo?: string;
	trx?: string;
	name?: string;
	data?: Record<string, unknown>;
}) {
	const [amount, symbol] = o.quantity.split(' ');
	return {
		'@timestamp': o.at,
		timestamp: o.at,
		block_num: 411372929,
		trx_id: o.trx ?? TXID(o.seq % 250),
		act: {
			account: o.contract ?? 'eosio.token',
			name: o.name ?? 'transfer',
			authorization: [{ actor: o.from, permission: 'active' }],
			data: o.data ?? { from: o.from, to: o.to, amount: Number(amount), symbol, memo: o.memo ?? '', quantity: o.quantity },
		},
		receipts: [{ receiver: o.contract ?? 'eosio.token', global_sequence: o.seq }],
		global_sequence: o.seq,
		producer: 'testproducer',
		action_ordinal: 1,
	};
}

export const actionsPage = (actions: unknown[], indexed = '2026-10-30T16:29:59.500') => ({
	query_time_ms: 8,
	cached: false,
	lib: 0,
	last_indexed_block: 411373568,
	last_indexed_block_time: indexed,
	total: { value: actions.length, relation: 'eq' },
	actions,
});

/** What a server does for one request: a status and body, or a failure to reach it. */
export type Reply = { status?: number; json?: unknown } | Error | 'hang';
export type Handler = (path: string, init: RequestInit | undefined) => Reply;

/**
 * A fake fetch. `servers` maps an origin to its handler; the calls are recorded. A server that
 * is not in the table fails to connect.
 */
export function fakeFetch(servers: Record<string, Handler>) {
	const calls: Array<{ origin: string; path: string; body: unknown }> = [];
	const fetchImpl: FetchLike = async (url, init) => {
		const u = new URL(url);
		const path = u.pathname + u.search;
		calls.push({ origin: u.origin, path, body: init?.body ? JSON.parse(String(init.body)) : null });
		const handler = servers[u.origin];
		if (!handler) throw new Error('connect ECONNREFUSED');
		const reply = handler(path, init);
		if (reply instanceof Error) throw reply;
		if (reply === 'hang') throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
		return new Response(JSON.stringify(reply.json ?? {}), { status: reply.status ?? 200, headers: { 'content-type': 'application/json' } });
	};
	return { fetchImpl, calls };
}

/** A chain API server's routes, from a table of answers by route. */
export function chainServer(routes: Record<string, (body: any) => Reply>, info: Record<string, unknown> = {}): Handler {
	return (path, init) => {
		const route = path.split('?')[0];
		if (route === '/v1/chain/get_info') return { json: getInfo(info) };
		const handler = routes[route];
		return handler ? handler(init?.body ? JSON.parse(String(init.body)) : null) : { status: 404, json: { message: 'not found' } };
	};
}

/** A Hyperion server's routes (matched on the path before the query string). */
export function hyperionServer(routes: Record<string, (query: URLSearchParams) => Reply>, healthChain?: string): Handler {
	return (path) => {
		const [route, qs] = path.split('?');
		if (route === '/v2/health') return { json: health({ chain_id: healthChain }) };
		const handler = routes[route];
		return handler ? handler(new URLSearchParams(qs ?? '')) : { status: 404, json: { message: 'not found' } };
	};
}

export const CHAIN = 'https://chain.test';
export const CHAIN2 = 'https://chain2.test';
export const HYPER = 'https://hyperion.test';
export const HYPER2 = 'https://hyperion2.test';
