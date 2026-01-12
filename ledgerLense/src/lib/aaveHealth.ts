/**
 * Placeholder for Aave health factor summaries.
 *
 * Expected shape (per wallet):
 * {
 *   hf: number;
 *   ltv: number;
 *   liquidationThreshold: number;
 *   borrowUsd: number;
 *   collateralUsd: number;
 * }
 *
 * Future work: persist daily records to power a health factor chart + alerts.
 */
export function getHealthFactorSummary() {
	// TODO: implement using Aave subgraph data
	return null;
}
