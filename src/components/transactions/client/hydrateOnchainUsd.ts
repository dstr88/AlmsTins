// src/components/dashboard/transactions/client/hydrateOnchainUsd.ts
import { allowlistSymbols } from '@/lib/prices/sanitizeSymbols';
import { normalizePriceSymbol, parseAmount, formatUsd } from './utils.ts';

export async function hydrateOnchainUsd(
  list: HTMLElement,
  displayThresholdUsd: number,
  signal?: AbortSignal,
): Promise<void> {
  const rows = Array.from(
    list.querySelectorAll<HTMLElement>('[data-type="row"][data-onchain="true"]'),
  );

  if (!rows.length) return;

  const symbols = new Set(rows.map(row => normalizePriceSymbol(row.dataset.symbol)).filter(Boolean));

  const sanitized = allowlistSymbols([...symbols]);
  if (!sanitized.length) return;

  let priceMap: Record<string, number> = {};

  try {
    const res = await fetch(
      `/api/market/coingecko-prices?symbols=${encodeURIComponent(sanitized.join(','))}`,
      { signal },
    );
    if (res.ok) {
      const { prices = {} } = await res.json();
      priceMap = prices;
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return;
    console.warn('Price fetch failed', err);
  }

  rows.forEach(row => {
    const raw = row.dataset.raw ?? '';
    const decimals = Number(row.dataset.decimals ?? 18);
    const symbol = normalizePriceSymbol(row.dataset.symbol);
    const price = priceMap[symbol] ?? 0;
    const amount = parseAmount(raw, decimals);
    const usd = amount * price;

    row.querySelector('[data-role="usd"]')?.replaceChildren(
      document.createTextNode(usd > 0 ? formatUsd(usd) : '—')
    );

    row.dataset.usd = String(usd);
    row.dataset.isDust = (usd > 0 && usd < displayThresholdUsd) ? 'true' : 'false';
  });
}