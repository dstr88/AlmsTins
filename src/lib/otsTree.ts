/**
 * The OpenTimestamps proof tree: read it, write it back, and merge a calendar's upgrade into it.
 *
 * Follows the official client (opentimestamps/python-opentimestamps core/timestamp.py, core/op.py,
 * core/notary.py, core/serialize.py). Only the operations a calendar path uses are accepted: append
 * (0xf0), prepend (0xf1) and SHA-256 (0x08). Anything else is refused, so an unexpected proof fails
 * closed rather than being guessed at.
 */
import { createHash } from 'node:crypto';

export const PENDING_TAG = Buffer.from('83dfe30d2ef90c8e', 'hex');
export const MAX_URI_LENGTH = 1000;
export const MAX_PAYLOAD_LENGTH = 8192;
export const MAX_OP_ARG_LENGTH = 4096;
const MAX_DEPTH = 256;

const OP_APPEND = 0xf0;
const OP_PREPEND = 0xf1;
const OP_SHA256 = 0x08;

export type Attestation =
	| { kind: 'pending'; uri: string }
	| { kind: 'other'; tag: Buffer; payload: Buffer };

export interface TreeOp {
	tag: number;
	arg: Buffer | null;
	child: TreeNode;
}

export interface TreeNode {
	msg: Buffer;
	attestations: Attestation[];
	ops: TreeOp[];
}

export class ProofFormatError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ProofFormatError';
	}
}

class Reader {
	private pos = 0;
	constructor(private readonly buf: Buffer) {}

	byte(): number {
		if (this.pos >= this.buf.length) throw new ProofFormatError('The proof ends early.');
		return this.buf[this.pos++];
	}

	bytes(n: number): Buffer {
		if (this.pos + n > this.buf.length) throw new ProofFormatError('The proof ends early.');
		const out = this.buf.subarray(this.pos, this.pos + n);
		this.pos += n;
		return Buffer.from(out);
	}

	/** Little-endian base-128 (LEB128), as the official client writes lengths. */
	varuint(): number {
		let value = 0;
		let shift = 0;
		for (;;) {
			const b = this.byte();
			value += (b & 0x7f) * 2 ** shift;
			if (!Number.isSafeInteger(value)) throw new ProofFormatError('A length in the proof is too large.');
			if ((b & 0x80) === 0) return value;
			shift += 7;
			if (shift > 56) throw new ProofFormatError('A length in the proof is too large.');
		}
	}

	varbytes(max: number): Buffer {
		const n = this.varuint();
		if (n > max) throw new ProofFormatError('A field in the proof is too long.');
		return this.bytes(n);
	}

	atEnd(): boolean {
		return this.pos === this.buf.length;
	}
}

class Writer {
	private readonly parts: Buffer[] = [];

	byte(b: number): void {
		this.parts.push(Buffer.from([b]));
	}

	bytes(b: Buffer): void {
		this.parts.push(b);
	}

	varuint(value: number): void {
		const out: number[] = [];
		let v = value;
		if (v === 0) out.push(0);
		while (v !== 0) {
			let b = v % 128;
			v = Math.floor(v / 128);
			if (v !== 0) b |= 0x80;
			out.push(b);
		}
		this.parts.push(Buffer.from(out));
	}

	varbytes(b: Buffer): void {
		this.varuint(b.length);
		this.parts.push(b);
	}

	toBuffer(): Buffer {
		return Buffer.concat(this.parts);
	}
}

function sha256(b: Buffer): Buffer {
	return createHash('sha256').update(b).digest();
}

/** The message an operation gives, or a refusal for an operation this module does not accept. */
export function applyOp(tag: number, arg: Buffer | null, msg: Buffer): Buffer {
	if (tag === OP_APPEND && arg) return Buffer.concat([msg, arg]);
	if (tag === OP_PREPEND && arg) return Buffer.concat([arg, msg]);
	if (tag === OP_SHA256 && !arg) return sha256(msg);
	throw new ProofFormatError(`The proof uses an operation this stamp does not accept (0x${tag.toString(16)}).`);
}

function parseAttestation(r: Reader): Attestation {
	const tag = r.bytes(8);
	const payload = r.varbytes(MAX_PAYLOAD_LENGTH);
	if (tag.equals(PENDING_TAG)) {
		const inner = new Reader(payload);
		const uri = inner.varbytes(MAX_URI_LENGTH).toString('utf8');
		if (!inner.atEnd()) throw new ProofFormatError('The pending attestation has extra bytes.');
		return { kind: 'pending', uri };
	}
	return { kind: 'other', tag, payload };
}

function parseEntry(r: Reader, node: TreeNode, tag: number, depth: number): void {
	if (tag === 0x00) {
		node.attestations.push(parseAttestation(r));
		return;
	}
	const hasArg = tag === OP_APPEND || tag === OP_PREPEND;
	if (!hasArg && tag !== OP_SHA256) {
		throw new ProofFormatError(`The proof uses an operation this stamp does not accept (0x${tag.toString(16)}).`);
	}
	const arg = hasArg ? r.varbytes(MAX_OP_ARG_LENGTH) : null;
	if (node.ops.some((op) => op.tag === tag && (op.arg === null ? arg === null : arg !== null && op.arg.equals(arg)))) {
		throw new ProofFormatError('The proof repeats an operation.');
	}
	const child = parseNode(r, applyOp(tag, arg, node.msg), depth - 1);
	node.ops.push({ tag, arg, child });
}

function parseNode(r: Reader, msg: Buffer, depth: number): TreeNode {
	if (depth <= 0) throw new ProofFormatError('The proof is nested too deeply.');
	const node: TreeNode = { msg, attestations: [], ops: [] };
	let tag = r.byte();
	while (tag === 0xff) {
		parseEntry(r, node, r.byte(), depth);
		tag = r.byte();
	}
	parseEntry(r, node, tag, depth);
	return node;
}

/** Reads a timestamp that starts from `msg` (the calendar's own answer, or the body of a proof). */
export function parseTimestamp(buf: Buffer, msg: Buffer): TreeNode {
	const r = new Reader(buf);
	const node = parseNode(r, msg, MAX_DEPTH);
	if (!r.atEnd()) throw new ProofFormatError('The timestamp has extra bytes after its end.');
	return node;
}

function writeAttestation(w: Writer, a: Attestation): void {
	w.bytes(a.kind === 'pending' ? PENDING_TAG : a.tag);
	const payload = new Writer();
	if (a.kind === 'pending') payload.varbytes(Buffer.from(a.uri, 'utf8'));
	else payload.bytes(a.payload);
	w.varbytes(payload.toBuffer());
}

function attestationKey(a: Attestation): Buffer {
	return a.kind === 'pending' ? PENDING_TAG : a.tag;
}

function writeNode(w: Writer, node: TreeNode): void {
	if (node.attestations.length === 0 && node.ops.length === 0) {
		throw new ProofFormatError('An empty timestamp cannot be written.');
	}
	const atts = [...node.attestations].sort((a, b) => Buffer.compare(attestationKey(a), attestationKey(b)));
	const ops = [...node.ops].sort((a, b) => a.tag - b.tag || Buffer.compare(a.arg ?? Buffer.alloc(0), b.arg ?? Buffer.alloc(0)));

	if (atts.length > 1) {
		for (const a of atts.slice(0, -1)) {
			w.bytes(Buffer.from([0xff, 0x00]));
			writeAttestation(w, a);
		}
	}
	if (ops.length === 0) {
		w.byte(0x00);
		writeAttestation(w, atts[atts.length - 1]);
		return;
	}
	if (atts.length > 0) {
		w.bytes(Buffer.from([0xff, 0x00]));
		writeAttestation(w, atts[atts.length - 1]);
	}
	for (const op of ops.slice(0, -1)) {
		w.byte(0xff);
		writeOp(w, op);
	}
	writeOp(w, ops[ops.length - 1]);
}

function writeOp(w: Writer, op: TreeOp): void {
	w.byte(op.tag);
	if (op.arg) w.varbytes(op.arg);
	writeNode(w, op.child);
}

/** The bytes of a timestamp tree, without the .ots header. */
export function serializeTimestamp(node: TreeNode): Buffer {
	const w = new Writer();
	writeNode(w, node);
	return w.toBuffer();
}

/** Each attestation the tree holds, with the message it commits to. */
export function pendingNodes(node: TreeNode, out: TreeNode[] = []): TreeNode[] {
	if (node.attestations.some((a) => a.kind === 'pending')) out.push(node);
	for (const op of node.ops) pendingNodes(op.child, out);
	return out;
}

/**
 * Adds an upgrade into a node. The upgrade starts from the same message, so its operations and
 * attestations attach to the node in place. Duplicate attestations and matching operations are merged.
 */
export function mergeInto(node: TreeNode, upgrade: TreeNode): void {
	for (const a of upgrade.attestations) {
		const same = node.attestations.some((b) =>
			a.kind === 'pending' && b.kind === 'pending' ? a.uri === b.uri : a.kind === 'other' && b.kind === 'other' && a.tag.equals(b.tag) && a.payload.equals(b.payload),
		);
		if (!same) node.attestations.push(a);
	}
	for (const op of upgrade.ops) {
		const match = node.ops.find((o) => o.tag === op.tag && (o.arg === null ? op.arg === null : op.arg !== null && o.arg.equals(op.arg)));
		if (match) mergeInto(match.child, op.child);
		else node.ops.push(op);
	}
}

/** Removes the pending attestations from a node, once an upgrade has replaced them. */
export function dropPending(node: TreeNode): void {
	node.attestations = node.attestations.filter((a) => a.kind !== 'pending');
}
