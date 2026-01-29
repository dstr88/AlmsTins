// src/components/dashboard/transactions/client/utils.ts
export function normalizePriceSymbol(symbol?: string | null): string {
  if (!symbol) return '';
  const upper = symbol.toUpperCase();
  if (upper === 'APOLWETH') return 'WETH';
  if (upper === 'APOLWMATIC') return 'POL';
  if (upper === 'APOLUSDC') return 'USDC';
  if (upper === 'APOLUSDT') return 'USDT';
  if (upper === 'APOLDAI') return 'DAI';
  if (upper === 'MATIC' || upper === 'WMATIC') return 'POL';
  return upper;
}

export function parseAmount(raw: string, decimals: number): number {
  if (!raw) return 0;
  const safeDecimals = Number.isFinite(decimals) ? decimals : 18;
  const padded = raw.padStart(safeDecimals + 1, '0');
  const whole = padded.slice(0, -safeDecimals) || '0';
  const fraction = padded.slice(-safeDecimals).replace(/0+$/, '');
  const numeric = Number(fraction ? `${whole}.${fraction}` : whole);
  return Number.isFinite(numeric) ? numeric : 0;
}

export function formatUsd(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '—';
  return `$${value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}