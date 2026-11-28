/**
 * Known DeFi and NFT contracts, by address, with the name a list shows for them and the site they belong to.
 * Shared by the wallet's "Contracts you've used" panel (/api/wallets/[id]/interactions) and the standing
 * approvals list (src/lib/approvals/spenders.ts). A name here is the contract's public product name, never a
 * person: nothing in Almstins links an address to who holds it.
 *
 * Token contracts (USDC, WETH and the like, for scam-token checks) are a different list: src/lib/knownContracts.ts.
 *
 * Pure data, no imports: usable from any module.
 */

export type KnownContract = { name: string; url: string };

export const KNOWN_CONTRACTS: Record<string, { name: string; url: string }> = {
	// Aave V3
	'0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2': { name: 'Aave V3 (Ethereum)', url: 'https://app.aave.com' },
	'0x794a61358d6845594f94dc1db02a252b5b4814ad': { name: 'Aave V3 (Avalanche/Polygon)', url: 'https://app.aave.com' },
	'0xa434d495249abe33e031fe71a969b81f3c07950d': { name: 'Aave V3 Pool Provider', url: 'https://app.aave.com' },
	// Aave V2
	'0x7d2768de32b0b80b7a3454c06bdac94a69ddc7a9': { name: 'Aave V2 (Ethereum)', url: 'https://app.aave.com' },
	'0x8dff5e27ea6b7ac08ebfdf9eb090f32ee9a30fcf': { name: 'Aave V2 (Polygon)', url: 'https://app.aave.com' },
	// Uniswap
	'0x7a250d5630b4cf539739df2c5dacb4c659f2488d': { name: 'Uniswap V2 Router', url: 'https://app.uniswap.org' },
	'0xe592427a0aece92de3edee1f18e0157c05861564': { name: 'Uniswap V3 Router', url: 'https://app.uniswap.org' },
	'0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45': { name: 'Uniswap V3 Router 2', url: 'https://app.uniswap.org' },
	'0x000000000004444c5dc75cb358380819da4efcee': { name: 'Uniswap V4 Router', url: 'https://app.uniswap.org' },
	// Compound
	'0x3d9819210a31b4961b30ef54be2aed79b9c9cd3b': { name: 'Compound V2 Comptroller', url: 'https://compound.finance' },
	'0xc3d688b66703497daa19211eedff47f25384cdc3': { name: 'Compound V3 (USDC)', url: 'https://app.compound.finance' },
	// Curve
	'0x8301ae4fc9c624d1d396cbdaa1ed877821d7c511': { name: 'Curve (ETH/CRV)', url: 'https://curve.fi' },
	'0xd51a44d3fae010294c616388b506acda1bfaae46': { name: 'Curve Tricrypto', url: 'https://curve.fi' },
	'0xbeefc012406bc99d10e2812b13b8b63ffb698d45': { name: 'Curve (Polygon)', url: 'https://curve.fi' },
	// Lido
	'0xae7ab96520de3a18e5e111b5eaab095312d7fe84': { name: 'Lido stETH', url: 'https://lido.fi' },
	'0x889edc2edab5f40e902b864ad4d7ade8e412f9b1': { name: 'Lido Withdrawals', url: 'https://lido.fi' },
	// MakerDAO / DAI
	'0x9759a6ac90977b93b58547b4a71c78317f391a28': { name: 'MakerDAO DSProxy', url: 'https://makerdao.com' },
	'0x5ef30b9986345249bc32d8928b7ee64de9435e39': { name: 'MakerDAO CDP Manager', url: 'https://makerdao.com' },
	// 1inch
	'0x1111111254eeb25477b68fb85ed929f73a960582': { name: '1inch V5', url: 'https://app.1inch.io' },
	'0x111111125421ca6dc452d289314280a0f8842a65': { name: '1inch V6', url: 'https://app.1inch.io' },
	// OpenSea
	'0x00000000000000adc04c56bf30ac9d3c0aaf14dc': { name: 'OpenSea Seaport 1.5', url: 'https://opensea.io' },
	'0x0000000000000068f116a894984e2db1123eb395': { name: 'OpenSea Seaport 1.6', url: 'https://opensea.io' },
	'0x7be8076f4ea4a4ad08075c2508e481d6c946d12b': { name: 'OpenSea V1', url: 'https://opensea.io' },
	// Blur
	'0x000000000000ad05ccc4f10045630fb830b95127': { name: 'Blur Marketplace', url: 'https://blur.io' },
	'0xb2ecfe4e4d61f8790bbb9de2d1259b9e2410cea5': { name: 'Blur Lending', url: 'https://blur.io' },
	// LooksRare
	'0x59728544b08ab483533076417fbbb2fd0b17ce3a': { name: 'LooksRare', url: 'https://looksrare.org' },
	// Rarible
	'0x9757f2d2b135150bbeb65308d4a91804107cd8d6': { name: 'Rarible', url: 'https://rarible.com' },
	// ENS
	'0x283af0b28c62c092c9727f1ee09c02ca627eb7f5': { name: 'ENS Registrar', url: 'https://ens.domains' },
	'0x57f1887a8bf19b14fc0df6fd9b2acc9af147ea85': { name: 'ENS BaseRegistrar', url: 'https://ens.domains' },
	// Gnosis Safe / Multisig
	'0x3e5c63644e683549055b9be8653de26e0b4cd36e': { name: 'Safe (Polygon)', url: 'https://safe.global' },
	'0x69f4d1788e39c87893c980c06edf4b7f686e2938': { name: 'Safe (Polygon Factory)', url: 'https://safe.global' },
	// Stargate (bridging)
	'0x8731d54e9d02c286767d56ac03e8037c07e01e98': { name: 'Stargate Router', url: 'https://stargate.finance' },
	// Polygon Bridge
	'0xa0c68c638235ee32657e8f720a23cec1bfc77c77': { name: 'Polygon Bridge', url: 'https://portal.polygon.technology' },
	'0x28e4f3a7f651294b9564800b2d01f35189a5bf8b': { name: 'Polygon Bridge V2', url: 'https://portal.polygon.technology' },
	// Avalanche Bridge
	'0x8eb8a3b98659cce290402893d0123abb75e3ab28': { name: 'Avalanche Bridge', url: 'https://core.app/bridge' },
	// Benqi (Avalanche lending)
	'0x486af39519b4dc9a7fccd318217352830e8ad9b4': { name: 'Benqi Comptroller', url: 'https://benqi.fi' },
	// Trader Joe (Avalanche DEX)
	'0x60ae616a2155ee3d9a68541ba4544862310933d4': { name: 'Trader Joe Router', url: 'https://traderjoexyz.com' },
	// WAVAX
	'0xb31f66aa3c1e785363f0875a1b74e27b85fd66c7': { name: 'WAVAX', url: 'https://snowtrace.io/address/0xb31f66aa3c1e785363f0875a1b74e27b85fd66c7' },
	// Wormhole
	'0x98f3c9e6e3face36baad05fe09d375ef1464288b': { name: 'Wormhole Bridge', url: 'https://wormhole.com' },
};

/** Uniswap's Permit2 contract: the same address on every chain it is deployed to. */
export const PERMIT2_ADDRESS = '0x000000000022d473030f116ddee9f6b43ac78ba3';

/** Contracts the approvals list names that the interactions panel never needed. */
const APPROVAL_ONLY: Record<string, KnownContract> = {
	[PERMIT2_ADDRESS]: { name: 'Uniswap Permit2', url: 'https://app.uniswap.org' },
};

/** The known contract at this address (any case), or null. */
export function knownContract(address: string): KnownContract | null {
	const a = String(address ?? '').trim().toLowerCase();
	return KNOWN_CONTRACTS[a] ?? APPROVAL_ONLY[a] ?? null;
}
