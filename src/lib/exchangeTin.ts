import { formatUsd } from '@/lib/format';
export type ExchangeHoldingRow = {
	symbol: string;
	balance: number;
	costBasis: number | null;
	lastPurchaseAt: string | null;
	priceUsd?: number | null;
};

export const formatNumber = (value: number, options?: Intl.NumberFormatOptions) =>
	new Intl.NumberFormat('en-US', options).format(value);

/** Dollars with cents, `$1,234.50` (src/lib/format.ts). */
export const formatCurrency = (value: number) => formatUsd(value);

export const formatDaysSince = (value: string | null) => {
	if (!value) return null;
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return null;
	const diffMs = Date.now() - date.getTime();
	return Math.max(0, Math.floor(diffMs / (24 * 60 * 60 * 1000)));
};

export const formatDaysSinceLabel = (value: string | null) => {
	const days = formatDaysSince(value);
	return days === null ? '—' : String(days);
};
