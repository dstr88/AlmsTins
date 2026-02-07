// src/lib/etherscan.ts
// Dedicated Etherscan client (v2).
// All Etherscan API calls should be routed through this module for centralized troubleshooting.

const ETHERSCAN_V2_BASE_URL = 'https://api.etherscan.io/v2/api';

export const CHAIN_IDS = {
  ethereum: 1,
  polygon: 137,
  avalanche: 43114, // NOTE: Avalanche is not Etherscan; you'd use Snowtrace instead.
} as const;

export type EtherscanOk<T> = { status: '1'; message: 'OK'; result: T };
export type EtherscanErr = { status: '0'; message: string; result: any };
export type EtherscanPayload<T> = EtherscanOk<T> | EtherscanErr;

function getEtherscanKey(): string {
  const key = import.meta.env.ETHERSCAN_API_KEY;
  if (!key) throw new Error('Missing ETHERSCAN_API_KEY');
  return String(key);
}

export function buildEtherscanV2Url(chainId: number, params: Record<string, string | number>) {
  const query = new URLSearchParams({
    apikey: getEtherscanKey(),
    chainid: String(chainId),
  });

  for (const [k, v] of Object.entries(params)) query.set(k, String(v));
  return `${ETHERSCAN_V2_BASE_URL}?${query.toString()}`;
}

type RequestOptions = {
  allowStatus0?: boolean;
  allowNoTx?: boolean;
  context?: string;
  log?: boolean;
};

export async function requestEtherscan<T>(
  chainId: number,
  params: Record<string, string | number>,
  options: RequestOptions = {},
) {
  const startedAt = Date.now();
  const url = buildEtherscanV2Url(chainId, params);
  const res = await fetch(url);
  const text = await res.text();
  const elapsedMs = Date.now() - startedAt;
  if (options.log !== false) {
    console.log('[etherscan] http', {
      ms: elapsedMs,
      status: res.status,
      chainId,
      action: String(params.action ?? ''),
      context: options.context,
    });
  }

  let payload: any;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(`Etherscan returned non-JSON: HTTP ${res.status} :: ${text.slice(0, 200)}`);
  }

  if (!res.ok) {
    throw new Error(`Etherscan HTTP ${res.status} :: ${text.slice(0, 200)}`);
  }

  // Etherscan often returns HTTP 200 even on API errors.
  if (String(payload?.status) === '0') {
    const msg = String(payload?.message ?? 'NOTOK');
    const details =
      typeof payload?.result === 'string' ? payload.result : JSON.stringify(payload.result);
    if (options.allowNoTx && msg === 'No transactions found') {
      return { payload: payload as EtherscanPayload<T>, url, httpStatus: res.status };
    }
    if (options.allowStatus0) {
      return { payload: payload as EtherscanPayload<T>, url, httpStatus: res.status };
    }
    throw new Error(`Etherscan NOTOK: ${msg} :: ${details}`);
  }

  return { payload: payload as EtherscanPayload<T>, url, httpStatus: res.status };
}

export function weiToEth(wei: bigint): number {
  // NOTE: number is fine for display; for accounting, keep bigint/string.
  const s = wei.toString().padStart(19, '0');
  const whole = s.slice(0, -18);
  const frac = s.slice(-18).replace(/0+$/, '');
  const out = frac ? `${whole}.${frac}` : whole;
  const n = Number(out);
  return Number.isFinite(n) ? n : 0;
}

/**
 * ✅ ACTIVE: Get native chain balance.
 * - Ethereum: returns wei
 * - Polygon: returns wei (MATIC/POL unit is still 18 decimals)
 */
export async function getNativeBalanceWei(address: string, chainId: number): Promise<bigint> {
  const startedAt = Date.now();
  const { payload } = await requestEtherscan<any>(
    chainId,
    {
      module: 'account',
      action: 'balance',
      address,
      tag: 'latest',
    },
    { context: 'balance' },
  );
  const elapsedMs = Date.now() - startedAt;
  console.log('[etherscan] balance', { chainId, ms: elapsedMs });
  return BigInt((payload as EtherscanOk<any>).result ?? '0');
}

/**
 * ✅ ACTIVE: Convenience wrapper for display.
 */
export async function getNativeBalanceDisplay(address: string, chainId: number) {
  const startedAt = Date.now();
  const wei = await getNativeBalanceWei(address, chainId);
  const elapsedMs = Date.now() - startedAt;
  console.log('[etherscan] balance.display', { chainId, ms: elapsedMs });
  return {
    wei: wei.toString(),
    decimal: weiToEth(wei), // 18 decimals display
  };
}

export type TokenTx = {
  blockNumber: string;
  timeStamp: string;
  hash: string;
  from: string;
  to: string;
  value: string;
  tokenDecimal: string;
  tokenSymbol: string;
  tokenName: string;
  contractAddress: string;
};

export type NftTx = {
  blockNumber: string;
  timeStamp: string;
  hash: string;
  from: string;
  to: string;
  tokenID?: string;
  tokenId?: string;
  tokenName?: string;
  tokenSymbol?: string;
  contractAddress?: string;
  [key: string]: any;
};

export async function getAccountAction<T>(
  chainId: number,
  params: Record<string, string | number>,
  options: RequestOptions = {},
) {
  const { payload, url, httpStatus } = await requestEtherscan<T>(chainId, params, options);
  return { payload, url, httpStatus };
}

export async function getTokenTransfersPage(
  address: string,
  chainId: number,
  page = 1,
  offset = 100,
) {
  return getAccountAction<TokenTx[]>(
    chainId,
    {
      module: 'account',
      action: 'tokentx',
      address,
      startblock: 0,
      endblock: 99999999,
      page,
      offset,
      sort: 'desc',
    },
    { allowNoTx: true, allowStatus0: true, context: 'tokentx' },
  );
}

export async function getNftTransfers(
  address: string,
  chainId: number,
  action: 'tokennfttx' | 'token1155tx',
) {
  const { payload } = await requestEtherscan<NftTx[]>(
    chainId,
    {
      module: 'account',
      action,
      address,
      page: 1,
      offset: 200,
      sort: 'desc',
    },
    { allowNoTx: true, context: action },
  );
  return Array.isArray(payload.result) ? (payload.result as NftTx[]) : [];
}

export async function getContractCode(chainId: number, address: string) {
  const { payload } = await requestEtherscan<string>(
    chainId,
    {
      module: 'proxy',
      action: 'eth_getCode',
      address,
      tag: 'latest',
    },
    { allowStatus0: true, context: 'eth_getCode' },
  );
  return String((payload as EtherscanPayload<string>).result ?? '');
}
