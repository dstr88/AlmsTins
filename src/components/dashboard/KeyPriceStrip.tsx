import React, { useMemo, useState } from 'react';
import { getClientLang } from '@/lib/i18n/clientLang';
import { getKeyPriceStrip } from '@/i18n/components/keyPriceStrip';

type SymbolCode = 'BTC' | 'ETH' | 'POL' | 'AVAX';

type KeyPriceHistoryPoint = {
	timestamp: number;
	priceUsd: number;
};

type KeyPriceRow = {
	symbol: SymbolCode;
	priceUsd: number;
	history?: KeyPriceHistoryPoint[];
};

const formatter = Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

const DEFAULT_HISTORY = (price: number) => [
	{ timestamp: Date.now() - 4 * 3600000, priceUsd: price * 0.985 },
	{ timestamp: Date.now() - 3 * 3600000, priceUsd: price * 1.01 },
	{ timestamp: Date.now() - 2 * 3600000, priceUsd: price * 0.995 },
	{ timestamp: Date.now() - 3600000, priceUsd: price * 1.005 },
	{ timestamp: Date.now(), priceUsd: price },
];

const INITIAL_DATA: KeyPriceRow[] = [
	{ symbol: 'BTC', priceUsd: 50000, history: DEFAULT_HISTORY(50000) },
	{ symbol: 'ETH', priceUsd: 3000, history: DEFAULT_HISTORY(3000) },
	{ symbol: 'POL', priceUsd: 0.9, history: DEFAULT_HISTORY(0.9) },
	{ symbol: 'AVAX', priceUsd: 40, history: DEFAULT_HISTORY(40) },
];

export default function KeyPriceStrip() {
	const [expandedSymbol, setExpandedSymbol] = useState<SymbolCode | null>(null);
	const t = getKeyPriceStrip(getClientLang());
	const keyPrices = INITIAL_DATA;

	const expandedRow = useMemo(() => keyPrices.find((row) => row.symbol === expandedSymbol), [expandedSymbol]);

	return (
		<div className="key-price-card">
			<h3>{t.heading}</h3>
			<ul className="key-price-list">
				{keyPrices.map((row) => (
					<li
						key={row.symbol}
						className={`key-price-row ${expandedSymbol === row.symbol ? 'key-price-row--expanded' : ''}`}
						onClick={() => setExpandedSymbol((prev) => (prev === row.symbol ? null : row.symbol))}
					>
						<div className="key-price-symbol">{row.symbol}</div>
						<div className="key-price-value">{formatter.format(row.priceUsd)}</div>
						<div className="key-price-sparkline">
							{row.history ? (
								<svg viewBox="0 0 60 16" preserveAspectRatio="none">
									<polyline
										points={buildSparklinePoints(row.history, 60, 16)}
										fill="none"
										stroke="currentColor"
										strokeWidth="1.6"
										strokeLinecap="round"
									/>
								</svg>
							) : (
								<div className="sparkline-placeholder">{t.sparklinePlaceholder}</div>
							)}
						</div>
					</li>
				))}
			</ul>

			{expandedRow && (
				<div className="key-price-expanded-panel">
					<h4>{t.priceActionHeading(expandedRow.symbol)}</h4>
					<div className="expanded-chart-placeholder">{t.expandedChartPlaceholder}</div>
				</div>
			)}
		</div>
	);
}

function buildSparklinePoints(history: KeyPriceHistoryPoint[], width: number, height: number) {
	if (!history.length) return '';
	const min = Math.min(...history.map((point) => point.priceUsd));
	const max = Math.max(...history.map((point) => point.priceUsd));
	const range = max - min || 1;

	return history
		.map((point, index) => {
			const x = (index / Math.max(history.length - 1, 1)) * width;
			const y = height - ((point.priceUsd - min) / range) * height;
			return `${x},${y}`;
		})
		.join(' ');
}
