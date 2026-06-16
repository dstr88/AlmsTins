import "@/styles/portfolio-preview-card.css";
import type { Lang } from "@/lib/i18n/locale";
import { getPortfolioPreviewCard } from "@/i18n/components/portfolioPreviewCard";

// SVG donut: r=56, cx=cy=70 → C = 2π×56 ≈ 351.858
// Segments (crypto 42%, stocks 41%, defi 17%)
const C = 351.858;
const segments = [
  { pct: 42, color: "var(--accent)", id: "crypto", offset: 0 },
  { pct: 41, color: "#8b9dc8",      id: "stocks", offset: -(C * 0.42) },
  { pct: 17, color: "var(--gain)",  id: "defi",   offset: -(C * 0.83) },
];

const holdings = [
  { symbol: "ETH",   chain: "Ethereum",  value: "$24,180", change: "+4.2%", up: true  },
  { symbol: "AAPL",  chain: "Apple Inc.", value: "$18,940", change: "+1.8%", up: true  },
  { symbol: "aUSDC", chain: "Aave USDC", value: "$8,320",  change: "+0.1%", up: true  },
  { symbol: "TSLA",  chain: "Tesla Inc.", value: "$6,240",  change: "-0.9%", up: false },
];

export default function PortfolioPreviewCard({ lang = "en" }: { lang?: Lang }) {
  const t = getPortfolioPreviewCard(lang);
  const segLabels: Record<string, string> = { crypto: t.segCrypto, stocks: t.segStocks, defi: t.segDefi };
  return (
    <div className="ppc ppc--tilt-target" id="portfolioPreviewCard">
      <div className="ppc__header">
        <span className="ppc__title">{t.samplePortfolio}</span>
        <span className="ppc__live">
          <span className="ppc__live-dot" />
          {t.live}
        </span>
      </div>

      <div className="ppc__total">
        <span className="ppc__total-value">$57,680</span>
        <span className="ppc__total-change">{t.totalChangeToday}</span>
      </div>

      <div className="ppc__donut-wrap">
        <svg className="ppc__donut" width="140" height="140" viewBox="0 0 140 140" aria-hidden="true">
          {segments.map((seg) => {
            const len = C * (seg.pct / 100);
            return (
              <circle
                key={seg.id}
                cx="70"
                cy="70"
                r="56"
                fill="none"
                stroke={seg.color}
                strokeWidth="18"
                strokeDasharray={`${len} ${C - len}`}
                strokeDashoffset={seg.offset}
                transform="rotate(-90 70 70)"
                strokeLinecap="butt"
              />
            );
          })}
          {/* Centre hole */}
          <circle cx="70" cy="70" r="47" fill="var(--surface-card)" />
          <text x="70" y="65" textAnchor="middle" fill="var(--text-primary)" fontSize="11" fontWeight="700" fontFamily="inherit">$57,680</text>
          <text x="70" y="79" textAnchor="middle" fill="var(--gain)" fontSize="8.5" fontFamily="inherit">{t.donutChangeToday}</text>
        </svg>

        <div className="ppc__legend">
          {segments.map((seg) => (
            <div className="ppc__legend-item" key={seg.id}>
              <span className="ppc__legend-dot" style={{ background: seg.color }} />
              <span className="ppc__legend-label">{segLabels[seg.id]}</span>
              <span className="ppc__legend-pct">{seg.pct}%</span>
            </div>
          ))}
        </div>
      </div>

      <div className="ppc__holdings">
        {holdings.map((h) => (
          <div className="ppc__holding" key={h.symbol}>
            <div className="ppc__holding-icon">{h.symbol.slice(0, 2)}</div>
            <div className="ppc__holding-name">
              <span className="ppc__holding-symbol">{h.symbol}</span>
              <span className="ppc__holding-chain">{h.chain}</span>
            </div>
            <div className="ppc__holding-right">
              <span className="ppc__holding-value">{h.value}</span>
              <span className={`ppc__holding-change ppc__holding-change--${h.up ? "up" : "down"}`}>
                {h.change}
              </span>
            </div>
          </div>
        ))}
      </div>

      <div className="ppc__footer">
        <span className="ppc__footer-label">{t.lastSynced}</span>
        <span className="ppc__footer-sync">{t.lastSyncedValue}</span>
      </div>

      <p className="ppc__footnote">{t.footnote}</p>
    </div>
  );
}
