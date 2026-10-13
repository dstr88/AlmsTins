import { describe, it, expect, vi } from 'vitest';

// The helpers are pure; the stub only keeps the module graph from opening a database.
vi.mock('@/lib/db', () => ({ db: { execute: async () => ({ rows: [], rowsAffected: 0 }) } }));

import { compareRows, mapImportRow, mapOnchainRow, mapSuiRow, plainNumber, rawToDecimal, toUtcDate } from '../../src/lib/historyRows';
import { csvCell, csvDocument, escapeFormula, fileSlug, parseYearParam } from '../../src/lib/historyExport';
import { canDownloadBookkeepingCsv, canDownloadHistoryByWallet } from '../../src/lib/historyAccess';
import { OWNER_TENANT_ID } from '../../src/lib/owner';

describe('numbers are plain decimal text, never negative, never exponent form', () => {
	it.each([
		[12.5, '12.5'],
		[-12.5, '12.5'],
		[0, '0'],
		[-0, '0'],
		[1e-7, '0.0000001'],
		[1.5e-10, '0.00000000015'],
		[1e21, '1000000000000000000000'],
		['3.25', '3.25'],
		[null, ''],
		[undefined, ''],
		['', ''],
		['abc', ''],
		[Number.NaN, ''],
		[Number.POSITIVE_INFINITY, ''],
	])('plainNumber(%s) → %s', (v, out) => {
		expect(plainNumber(v)).toBe(out);
	});

	it.each([
		['1500000000000000000', 18, '1.5'],
		['1', 18, '0.000000000000000001'],
		['2500000', 6, '2.5'],
		['100000000', 8, '1'],
		['0', 18, '0'],
		['-1000000000', 9, '1'],
		['123', 0, '123'],
		['1500000000000000000', null, '1.5'],
		['0x14d1120d7b160000', 18, '1.5'],
		['1.5e18', 18, '1.5'],
		['2.75', 18, '2.75'],
		['', 18, ''],
		['12abc', 18, ''],
		[null, 18, ''],
	])('rawToDecimal(%s, %s) → %s, exactly', (raw, decimals, out) => {
		expect(rawToDecimal(raw, decimals)).toBe(out);
	});

	it('keeps every digit of a value too large for a float', () => {
		expect(rawToDecimal('123456789012345678901234567890', 18)).toBe('123456789012.34567890123456789');
	});
});

describe('dates are UTC', () => {
	it.each([
		['2025-03-04T12:34:56.000Z', '2025-03-04 12:34:56'],
		['2025-03-04 12:34:56', '2025-03-04 12:34:56'], // stored without a zone means UTC
		['2025-03-04T12:34:56', '2025-03-04 12:34:56'],
		['2025-03-04T14:34:56+02:00', '2025-03-04 12:34:56'],
		['2025-03-04', '2025-03-04 00:00:00'],
	])('%s → %s', (raw, out) => {
		expect(toUtcDate(raw).date).toBe(out);
	});

	it('an unreadable timestamp is kept as stored, and an empty one is empty', () => {
		expect(toUtcDate('not a date')).toEqual({ date: 'not a date', sortKey: 'not a date' });
		expect(toUtcDate(null)).toEqual({ date: '', sortKey: '' });
	});
});

describe('CSV cells', () => {
	it.each([['=1+1'], ['+1'], ['-1'], ['@SUM(A1)'], ['\tx'], ['\rx']])('%j gets a leading quote mark', (v) => {
		expect(escapeFormula(v)).toBe(`'${v}`);
	});

	it.each([['ETH'], ['1.5'], [''], [' =1'], ['a=b'], ["'already"]])('%j is left alone', (v) => {
		expect(escapeFormula(v)).toBe(v);
	});

	it('quotes a cell with a comma, quote or line break, after escaping', () => {
		expect(csvCell('a,b')).toBe('"a,b"');
		expect(csvCell('say "hi"')).toBe('"say ""hi"""');
		expect(csvCell('line\nbreak')).toBe('"line\nbreak"');
		expect(csvCell('=A1,B1')).toBe(`"'=A1,B1"`);
		expect(csvCell(null)).toBe('');
	});

	it('a document starts with a BOM and uses CRLF', () => {
		expect(csvDocument(['a', 'b'])).toBe('﻿a\r\nb\r\n');
	});

	it.each([
		['Crypto.com · Account #2', 'crypto-com-account-2'],
		['Épargne de Zoé', 'epargne-de-zoe'],
		['../../etc/passwd', 'etc-passwd'],
		['', 'wallet'],
		['···', 'wallet'],
		['a'.repeat(60), 'a'.repeat(40)],
	])('fileSlug(%j) → %s', (v, out) => {
		expect(fileSlug(v)).toBe(out);
	});
});

describe('?year=', () => {
	const now = new Date('2026-10-12T00:00:00Z');
	it('absent or empty means all years', () => {
		expect(parseYearParam(null, now)).toEqual({ ok: true });
		expect(parseYearParam('', now)).toEqual({ ok: true });
	});
	it.each([['2009', 2009], ['2025', 2025], ['2027', 2027]])('%s is a year', (raw, year) => {
		expect(parseYearParam(raw, now)).toEqual({ ok: true, year });
	});
	it.each([['2008'], ['2028'], ['25'], ['2025a'], [' 2025'], ['all']])('%j is invalid', (raw) => {
		expect(parseYearParam(raw, now)).toEqual({ ok: false });
	});
});

describe('row mappers', () => {
	it('an imported trade reports the asset received and its amount, not the fiat side', () => {
		const r = mapImportRow({
			id: 'x', source: 'crypto_com', account_id: 'a1', timestamp_utc: '2025-01-01 00:00:00', asset_symbol: 'BTC',
			currency: 'USD', amount: -500, to_currency: 'BTC', to_amount: 0.01, native_currency: 'USD', native_amount: -500, direction: 'in',
		});
		expect([r.asset, r.amount, r.usdValue]).toEqual(['BTC', '0.01', '500']);
		expect(r.ref).toEqual({ kind: 'account', source: 'crypto_com', accountId: 'a1' });
	});

	it('a USD value in another currency is not reported as USD', () => {
		const r = mapImportRow({ id: 'x', source: 'kraken', timestamp_utc: '2025-01-01', asset_symbol: 'ETH', amount: 1, native_currency: 'EUR', native_amount: 3000, direction: 'out' });
		expect(r.usdValue).toBe('');
	});

	it('a USD fee is labeled USD; a fee in the asset keeps its currency', () => {
		expect(mapImportRow({ id: 'x', source: 'coinbase', timestamp_utc: '2025-01-01', asset_symbol: 'ETH', amount: 1, fee_usd: 1.99 }).feeAsset).toBe('USD');
		const n = mapImportRow({ id: 'x', source: 'coinbase', timestamp_utc: '2025-01-01', asset_symbol: 'ETH', amount: 1, fee_native: 0.0001, fee_currency: 'ETH' });
		expect([n.fee, n.feeAsset]).toEqual(['0.0001', 'ETH']);
	});

	it('a chain-synced import keys on its wallet; with no wallet it falls back to its account', () => {
		expect(mapImportRow({ id: 'x', source: 'solana', account_id: 'a', wallet_id: 'w', timestamp_utc: '2025-01-01' }).ref).toEqual({
			kind: 'wallet', walletId: 'w', chain: 'solana',
		});
		expect(mapImportRow({ id: 'x', source: 'avalanche_cchain', account_id: 'a', timestamp_utc: '2025-01-01' }).ref).toEqual({
			kind: 'account', source: 'avalanche_cchain', accountId: 'a',
		});
		expect(mapImportRow({ id: 'x', source: 'crypto_com', account_id: '', timestamp_utc: '2025-01-01' }).ref).toEqual({
			kind: 'account', source: 'crypto_com', accountId: null,
		});
	});

	it('a manual custom-wallet entry takes its amount, direction and value from what the user entered', () => {
		const r = mapOnchainRow({
			id: 'm', wallet_id: 'w-c', chain: 'custom', hash: 'manual_abc', timestamp: '2025-02-02T00:00:00.000Z', token_symbol: 'ADA',
			tx_type: 'sell', metadata_json: JSON.stringify({ isCustomEntry: true, path: 'manual', direction: 'out', amount: 250, usdValue: 100, notes: 'OTC', kind: 'sell' }),
		});
		expect([r.direction, r.amount, r.usdValue, r.txHash, r.notes, r.category]).toEqual(['out', '250', '100', '', 'OTC', 'sell']);
	});

	it('an incoming on-chain transfer shows no fee (the sender paid it)', () => {
		const w = '0x' + '1'.repeat(40);
		const r = mapOnchainRow({
			id: 'i', wallet_id: 'w', wallet_address: w, chain: 'ethereum', hash: '0xh', timestamp: '2025-01-01T00:00:00Z', from_address: '0x' + '2'.repeat(40),
			to_address: w, value: '1000000000000000000', token_symbol: 'native', token_decimals: 18, tx_type: 'incoming', fee_paid: '21000000000000',
		});
		expect([r.direction, r.amount, r.asset, r.fee, r.counterparty]).toEqual(['in', '1', 'ETH', '', '0x' + '2'.repeat(40)]);
	});

	it('a Sui coin row that is not SUI never carries the gas fee', () => {
		const r = mapSuiRow({ id: 's', wallet_id: 'w', digest: 'd', coin_type: '0xabc::usdc::USDC', symbol: 'USDC', amount: '-5000000', decimals: 6, timestamp: '2025-01-01T00:00:00Z', fee_mist: '1000' })!;
		expect([r.direction, r.amount, r.fee]).toEqual(['out', '5', '']);
		expect(mapSuiRow({ id: 'z', wallet_id: 'w', coin_type: '0x2::sui::SUI', symbol: 'SUI', amount: '0', fee_mist: '0', timestamp: '2025-01-01' })).toBeNull();
		const feeOnly = mapSuiRow({ id: 'f', wallet_id: 'w', coin_type: '0x2::sui::SUI', symbol: 'SUI', amount: '0', fee_mist: '1500000', timestamp: '2025-01-01' })!;
		expect([feeOnly.direction, feeOnly.amount, feeOnly.fee, feeOnly.feeAsset]).toEqual(['out', '0', '0.0015', 'SUI']);
	});

	it('an imported row the exchange file marked lost keeps the direction lost, never blank', () => {
		// crypto-com.ts and robinhood.ts store direction 'lost' for lost, burned and wrong-chain rows.
		const r = mapImportRow({ id: 'l', source: 'crypto_com', account_id: 'a', timestamp_utc: '2025-01-01', asset_symbol: 'CRO', currency: 'CRO', amount: -3, direction: 'lost', kind: 'lost' });
		expect([r.direction, r.amount, r.asset]).toEqual(['lost', '3', 'CRO']);
		expect(mapImportRow({ id: 'l', source: 'robinhood', timestamp_utc: '2025-01-01', asset_symbol: 'BTC', amount: 1, direction: 'LOST' }).direction).toBe('lost');
	});

	it('an imported row with no usable direction takes it from the sign of the amount', () => {
		const dir = (direction: unknown, amount: unknown) =>
			mapImportRow({ id: 'd', source: 'coinbase', timestamp_utc: '2025-01-01', asset_symbol: 'ETH', amount, direction }).direction;
		expect(dir(null, -0.5)).toBe('out');
		expect(dir(undefined, 0.5)).toBe('in');
		expect(dir('transfer', -2)).toBe('out');
		expect(dir('', 2)).toBe('in');
		expect(dir(null, 0)).toBe('');
		expect(dir(null, null)).toBe('');
		// A stored in or out wins over the sign.
		expect(dir('in', -500)).toBe('in');
	});

	describe('Sui: the gas is counted once', () => {
		const sui = (over: Record<string, unknown>) =>
			mapSuiRow({ id: 's', wallet_id: 'w', digest: 'd', coin_type: '0x2::sui::SUI', symbol: 'SUI', decimals: 9, timestamp: '2025-01-01T00:00:00Z', status: 'success', ...over });

		it('the SUI row the wallet paid gas from shows the amount sent without the gas, and the gas as the fee', () => {
			// A token send: the SUI balance went down only by the gas.
			const gasOnly = sui({ amount: '-2000000', fee_mist: '2000000' })!;
			expect([gasOnly.direction, gasOnly.amount, gasOnly.fee, gasOnly.feeAsset]).toEqual(['out', '0', '0.002', 'SUI']);
			// A SUI send of 1.5 with 0.002 gas: the balance went down by 1.502.
			const send = sui({ amount: '-1502000000', fee_mist: '2000000' })!;
			expect([send.direction, send.amount, send.fee]).toEqual(['out', '1.5', '0.002']);
		});

		it('when the wallet also received SUI and the balance went down by less than the gas, the row is the receipt plus the fee', () => {
			const r = sui({ amount: '-1000', fee_mist: '3000' })!;
			expect([r.direction, r.amount, r.fee]).toEqual(['in', '0.000002', '0.000003']);
		});

		it('an amount that cannot be split exactly keeps the balance change and leaves the fee blank, never both', () => {
			const r = sui({ amount: '-1.5e9', fee_mist: '2000000' })!;
			expect([r.amount, r.fee]).toEqual(['1.5', '']);
		});

		it('a failed transaction moves nothing: amount 0, the gas as the fee', () => {
			const r = sui({ amount: '-1502000000', fee_mist: '2000000', status: 'failure' })!;
			expect([r.direction, r.amount, r.fee, r.failed]).toEqual(['out', '0', '0.002', true]);
			// A failed row of another coin carries no gas and moved nothing: left out.
			expect(sui({ coin_type: '0xabc::usdc::USDC', symbol: 'USDC', decimals: 6, amount: '-5000000', fee_mist: '2000000', status: 'failure' })).toBeNull();
		});

		it('a received SUI row carries no fee and keeps its amount', () => {
			const r = sui({ amount: '2500000000', fee_mist: '2000000' })!;
			expect([r.direction, r.amount, r.fee]).toEqual(['in', '2.5', '']);
		});
	});

	it('ties in time are ordered by half, then id', () => {
		const base = mapImportRow({ id: 'b', source: 'coinbase', timestamp_utc: '2025-01-01' });
		const rows = [
			{ ...base, origin: 'sui' as const, id: 'a' },
			{ ...base, origin: 'import' as const, id: 'z' },
			{ ...base, origin: 'import' as const, id: 'c' },
		].sort(compareRows);
		expect(rows.map((r) => `${r.origin}:${r.id}`)).toEqual(['import:c', 'import:z', 'sui:a']);
	});
});

describe('who may download', () => {
	it('history by wallet: any paid plan, the owner always, everything else is free', () => {
		for (const p of ['starter', 'pro', 'unlimited']) expect(canDownloadHistoryByWallet(p, 'tenant-a'), p).toBe(true);
		for (const p of ['free', 'paid', '', null, undefined, 'enterprise']) expect(canDownloadHistoryByWallet(p, 'tenant-a'), String(p)).toBe(false);
		expect(canDownloadHistoryByWallet('free', OWNER_TENANT_ID)).toBe(true);
	});

	it('bookkeeping CSVs: the same rule breakdown-csv.ts applies (refused only on the free plan)', () => {
		expect(canDownloadBookkeepingCsv('free')).toBe(false);
		expect(canDownloadBookkeepingCsv(null)).toBe(false);
		for (const p of ['starter', 'pro', 'unlimited']) expect(canDownloadBookkeepingCsv(p)).toBe(true);
	});
});
