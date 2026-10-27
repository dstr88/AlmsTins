/**
 * Stage 2: upgrade a pending .ots proof once its Bitcoin block confirms. Each pending attestation
 * names a calendar; the calendar answers GET /timestamp/<commitment> with the completed path (404
 * until it is ready). The path is merged into the proof where the pending entry was.
 *
 * The result is written back and read again before it is returned, so a bad merge cannot leave a
 * file that only looks right. A calendar that is not an OpenTimestamps host is never called.
 */
import { OTS_HEADER_MAGIC, OTS_MAJOR_VERSION, SHA256_DIGEST_LENGTH, SHA256_OP_TAG } from '@/lib/otsStamp';
import {
	ProofFormatError,
	dropPending,
	mergeInto,
	parseTimestamp,
	pendingNodes,
	serializeTimestamp,
	type TreeNode,
} from '@/lib/otsTree';

const CALENDAR_HOST_SUFFIX = '.opentimestamps.org';
const UPGRADE_TIMEOUT_MS = 15_000;
const MAX_UPGRADE_BYTES = 1024 * 1024;

export function calendarAllowed(uri: string): boolean {
	let url: URL;
	try {
		url = new URL(uri);
	} catch {
		return false;
	}
	return url.protocol === 'https:' && url.hostname.endsWith(CALENDAR_HOST_SUFFIX) && url.port === '' && url.username === '';
}

export interface UpgradeResult {
	ots: Buffer;
	upgraded: number;
	stillPending: number;
}

function splitProof(ots: Buffer): { digest: Buffer; body: Buffer } {
	if (ots.length < OTS_HEADER_MAGIC.length + 2 + SHA256_DIGEST_LENGTH) {
		throw new ProofFormatError('The file is too short to be a proof.');
	}
	if (!ots.subarray(0, OTS_HEADER_MAGIC.length).equals(OTS_HEADER_MAGIC)) {
		throw new ProofFormatError('This is not an OpenTimestamps proof.');
	}
	const at = OTS_HEADER_MAGIC.length;
	if (ots[at] !== OTS_MAJOR_VERSION) throw new ProofFormatError('Unsupported proof version.');
	if (ots[at + 1] !== SHA256_OP_TAG) throw new ProofFormatError('The proof is not for a SHA-256 digest.');
	const digest = Buffer.from(ots.subarray(at + 2, at + 2 + SHA256_DIGEST_LENGTH));
	return { digest, body: ots.subarray(at + 2 + SHA256_DIGEST_LENGTH) };
}

function headerFor(digest: Buffer): Buffer {
	return Buffer.concat([OTS_HEADER_MAGIC, Buffer.from([OTS_MAJOR_VERSION, SHA256_OP_TAG]), digest]);
}

async function fetchUpgrade(
	uri: string,
	msg: Buffer,
	fetchImpl: typeof fetch,
): Promise<Buffer | null> {
	const res = await fetchImpl(`${uri}/timestamp/${msg.toString('hex')}`, {
		method: 'GET',
		headers: { Accept: 'application/octet-stream' },
		signal: AbortSignal.timeout(UPGRADE_TIMEOUT_MS),
	});
	if (res.status === 404) return null;
	if (!res.ok) throw new Error(`${uri} answered ${res.status}`);
	const body = Buffer.from(await res.arrayBuffer());
	if (body.length === 0 || body.length > MAX_UPGRADE_BYTES) return null;
	return body;
}

function hasConfirmed(node: TreeNode): boolean {
	return node.attestations.some((a) => a.kind === 'other');
}

/**
 * Asks each calendar for its completed path and merges any that are ready. Proofs that are still
 * pending, or whose calendar is unreachable, are returned unchanged.
 */
export async function upgradeOts(
	ots: Buffer,
	opts: { fetchImpl?: typeof fetch } = {},
): Promise<UpgradeResult> {
	const fetchImpl = opts.fetchImpl ?? fetch;
	const { digest, body } = splitProof(ots);
	const root = parseTimestamp(body, digest);

	let upgraded = 0;
	for (const node of pendingNodes(root)) {
		const uris = node.attestations.flatMap((a) => (a.kind === 'pending' ? [a.uri] : []));
		for (const uri of uris) {
			if (!calendarAllowed(uri)) continue;
			let answer: Buffer | null;
			try {
				answer = await fetchUpgrade(uri, node.msg, fetchImpl);
			} catch {
				continue;
			}
			if (!answer) continue;
			let path: TreeNode;
			try {
				path = parseTimestamp(answer, node.msg);
			} catch {
				continue;
			}
			if (!hasConfirmed(path)) continue;
			mergeInto(node, path);
			dropPending(node);
			upgraded += 1;
		}
	}

	const out = Buffer.concat([headerFor(digest), serializeTimestamp(root)]);
	// Read it back before it leaves here.
	parseTimestamp(out.subarray(headerFor(digest).length), digest);
	const stillPending = pendingNodes(root).reduce((n, node) => n + node.attestations.filter((a) => a.kind === 'pending').length, 0);
	return { ots: upgraded > 0 ? out : ots, upgraded, stillPending };
}
