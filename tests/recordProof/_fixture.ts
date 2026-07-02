import type { AnnualBreakdown } from '@/lib/annualBreakdown';

/** A representative Year-Summary breakdown with one line of each kind. */
export const sampleBreakdown = (): AnnualBreakdown => ({
  year: 2024, availableYears: [2024],
  needsAttention: [
    { asset: 'XRP', amount: 100, sellDate: '2024-04-01', proceedsUsd: 50, sourceId: 's1', groupId: 'g1', txHash: '0xfeed', transactionClass: 'other', sourceType: 'Venmo' },
  ],
  stillHolding: [{ asset: 'SOL', amount: 10, acquiredDate: '2024-01-01', costUsd: 1000, daysHeld: 200 }],
  shortTerm: [{ asset: 'ETH', amount: 1.5, buyDate: '2023-12-01', sellDate: '2024-03-01', costUsd: 1800, proceedsUsd: 3000, gainLossUsd: 1200, daysHeld: 91, basisSource: 'recorded' }],
  longTerm: [{ asset: 'BTC', amount: 0.2, buyDate: '2022-01-01', sellDate: '2024-06-01', costUsd: 5000, proceedsUsd: 12000, gainLossUsd: 7000, daysHeld: 882, basisSource: 'estimated' }],
  income: [{ asset: 'ETH', amount: 0.1, usdValue: 300, date: '2024-05-01', kind: 'Staking Income', description: 'reward', priceSource: 'coingecko:range', priceAsof: '2024-05-01T09:03:00.000Z' }],
  cardRebates: [],
  transactionCosts: [{ date: '2024-03-01', source: 'coinbase', asset: 'ETH', feeUsd: 4.5, feeNative: null, feeCurrency: null, description: 'Trade fee' }],
  gasByChain: [{ chain: 'ethereum', nativeSymbol: 'ETH', totalNative: 0.012, txCount: 3 }],
  feeCoverage: { withFee: 1, total: 5 },
  nftHoldings: [],
  totals: { unsettledProceeds: 50, shortTermGain: 1200, longTermGain: 7000, totalIncome: 300, heldCostBasis: 1000, transactionCostsUsd: 4.5 },
  dataSource: 'lifecycle', method: 'fifo',
});
