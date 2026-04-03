// src/lib/nftImageUrl.ts
//
// Fetches NFT image URLs from on-chain metadata using public RPCs — no API key needed.
// Strategy:
//   1. eth_call tokenURI(tokenId) on the contract  →  metadata URI
//   2. Fetch metadata JSON (HTTP or IPFS via Cloudflare gateway)
//   3. Extract and resolve the `image` field
//
// Falls back silently to null on any failure or timeout.

const PUBLIC_RPCS: Record<number, string> = {
	1:     'https://eth.llamarpc.com',
	137:   'https://polygon.llamarpc.com',
	43114: 'https://avalanche.public-rpc.com',
};

const IPFS_GATEWAY = 'https://cloudflare-ipfs.com/ipfs/';

// ERC-721 tokenURI(uint256) → 0xc87b56dd
// ERC-1155 uri(uint256)     → 0x0e89341c
const ERC721_SELECTOR  = '0xc87b56dd';
const ERC1155_SELECTOR = '0x0e89341c';

const RPC_TIMEOUT_MS      = 2500;
const METADATA_TIMEOUT_MS = 3000;

function encodeUint256(tokenId: string): string {
	try {
		return BigInt(tokenId).toString(16).padStart(64, '0');
	} catch {
		return '0'.padStart(64, '0');
	}
}

// ABI-decode a dynamic string returned by eth_call.
// Layout: [32-byte offset][32-byte length][utf-8 bytes…]
function decodeAbiString(hex: string): string {
	const data = hex.startsWith('0x') ? hex.slice(2) : hex;
	if (data.length < 128) return '';
	const length = parseInt(data.slice(64, 128), 16);
	if (!length || length > 8192) return '';
	const strHex = data.slice(128, 128 + length * 2);
	let str = '';
	for (let i = 0; i < strHex.length - 1; i += 2) {
		str += String.fromCharCode(parseInt(strHex.slice(i, i + 2), 16));
	}
	return str;
}

function resolveIpfs(uri: string): string {
	if (uri.startsWith('ipfs://')) return IPFS_GATEWAY + uri.slice(7);
	// Some contracts return bare CIDs or /ipfs/ paths
	if (uri.startsWith('/ipfs/')) return IPFS_GATEWAY + uri.slice(6);
	return uri;
}

function resolveImageUrl(image: unknown): string | null {
	if (typeof image !== 'string' || !image) return null;
	if (image.startsWith('data:image/')) return image;
	if (image.startsWith('ipfs://') || image.startsWith('/ipfs/')) return resolveIpfs(image);
	if (image.startsWith('http://') || image.startsWith('https://')) return image;
	return null;
}

async function fetchWithTimeout(url: string, timeoutMs: number, init?: RequestInit): Promise<Response> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		return await fetch(url, { ...init, signal: controller.signal });
	} finally {
		clearTimeout(timer);
	}
}

async function ethCall(chainId: number, to: string, data: string): Promise<string | null> {
	const rpc = PUBLIC_RPCS[chainId];
	if (!rpc) return null;
	try {
		const res = await fetchWithTimeout(rpc, RPC_TIMEOUT_MS, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				jsonrpc: '2.0',
				method: 'eth_call',
				params: [{ to, data }, 'latest'],
				id: 1,
			}),
		});
		if (!res.ok) return null;
		const json = await res.json();
		const result = String(json?.result ?? '');
		return result && result !== '0x' ? result : null;
	} catch {
		return null;
	}
}

async function getTokenUri(chainId: number, contract: string, tokenId: string): Promise<string | null> {
	const encoded = encodeUint256(tokenId);

	// Try ERC-721 tokenURI first, fall back to ERC-1155 uri
	for (const selector of [ERC721_SELECTOR, ERC1155_SELECTOR]) {
		const result = await ethCall(chainId, contract, selector + encoded);
		if (!result) continue;
		const uri = decodeAbiString(result);
		if (!uri) continue;

		// ERC-1155 uses {id} placeholder — replace with zero-padded hex token ID
		const resolved = uri.includes('{id}')
			? uri.replace('{id}', encoded)
			: uri;

		return resolved || null;
	}
	return null;
}

async function fetchImageFromMetadata(metadataUri: string): Promise<string | null> {
	// Inline base64 JSON (data:application/json;base64,…)
	if (metadataUri.startsWith('data:application/json')) {
		try {
			const [, b64] = metadataUri.split(',');
			const json = JSON.parse(Buffer.from(b64, 'base64').toString('utf-8'));
			return resolveImageUrl(json?.image);
		} catch {
			return null;
		}
	}

	const url = resolveIpfs(metadataUri);
	try {
		const res = await fetchWithTimeout(url, METADATA_TIMEOUT_MS);
		if (!res.ok) return null;
		const json = await res.json();
		return resolveImageUrl(json?.image);
	} catch {
		return null;
	}
}

/**
 * Fetch the image URL for a single NFT.
 * Returns null on any failure — never throws.
 */
export async function fetchNftImageUrl(
	chainId: number,
	contract: string,
	tokenId: string,
): Promise<string | null> {
	try {
		const uri = await getTokenUri(chainId, contract, tokenId);
		if (!uri) return null;
		return await fetchImageFromMetadata(uri);
	} catch {
		return null;
	}
}

/**
 * Fetch image URLs for multiple NFTs in parallel with a concurrency cap.
 * Always returns an array the same length as `nfts`, with null for failures.
 */
export async function fetchNftImageUrls(
	nfts: Array<{ chainId: number; contract: string; tokenId: string }>,
	concurrency = 4,
): Promise<Array<string | null>> {
	if (!nfts.length) return [];

	const results: Array<string | null> = new Array(nfts.length).fill(null);
	const queue = nfts.map((nft, i) => ({ nft, i }));

	await Promise.all(
		Array.from({ length: Math.min(concurrency, nfts.length) }, async () => {
			while (queue.length > 0) {
				const item = queue.shift();
				if (!item) break;
				results[item.i] = await fetchNftImageUrl(
					item.nft.chainId,
					item.nft.contract,
					item.nft.tokenId,
				);
			}
		}),
	);

	return results;
}
