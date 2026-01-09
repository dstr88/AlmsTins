import Chart from 'chart.js/auto';

type ReserveOption = {
	label: string;
	reserveId: string;
	poolId: string;
	color?: string;
};

const API_TIMEOUT_MS = 15000;
const API_BASE_URL = '/api/aave-rates';

const RESERVES: ReserveOption[] = getReserveList();
const canvas = document.getElementById('aave-rate-chart') as HTMLCanvasElement | null;
const statusEl = document.querySelector<HTMLElement>('[data-status]');
const updatedEl = document.querySelector<HTMLElement>('[data-updated]');
const reserveSelect = document.getElementById('reserve-select') as HTMLSelectElement | null;
const windowSelect = document.getElementById('window-select') as HTMLSelectElement | null;
const customPoolInput = document.getElementById('custom-pool') as HTMLInputElement | null;
const customReserveInput = document.getElementById('custom-reserve') as HTMLInputElement | null;
const customLabelInput = document.getElementById('custom-label') as HTMLInputElement | null;
const customLoadButton = document.getElementById('custom-load') as HTMLButtonElement | null;
const FALLBACK_WINDOW = getFallbackWindow();
const defaultReserveId = getInitialReserveId();
const DEFAULT_WINDOW = getInitialWindowDays();

let chart: Chart | undefined;
let latestReserveLabel = getReserveLabel(defaultReserveId);

init();

function init() {
	if (!canvas || !reserveSelect || !windowSelect || !RESERVES.length) {
		console.warn('Chart setup skipped: required DOM nodes missing.');
		return;
	}

	reserveSelect.addEventListener('change', () => {
		const windowDays = Number(windowSelect.value || DEFAULT_WINDOW);
		loadRates(reserveSelect.value, windowDays);
	});

	windowSelect.addEventListener('change', () => {
		const windowDays = Number(windowSelect.value || DEFAULT_WINDOW);
		loadRates(reserveSelect.value, windowDays);
	});

	wireCustomLoader();
	loadRates(defaultReserveId, DEFAULT_WINDOW);
}

function getReserveList(): ReserveOption[] {
	const blob = document.getElementById('reserve-data');
	if (!blob || !blob.textContent) return [];
	try {
		const parsed = JSON.parse(blob.textContent);
		if (!Array.isArray(parsed)) return [];
		return parsed.filter((reserve: Partial<ReserveOption>): reserve is ReserveOption => {
			return typeof reserve?.reserveId === 'string' && typeof reserve?.poolId === 'string';
		});
	} catch (error) {
		console.error('Failed to parse reserve list', error);
		return [];
	}
}

function getFallbackWindow() {
	const carrier = document.querySelector<HTMLElement>('[data-default-window]');
	if (carrier) {
		const parsed = Number(carrier.getAttribute('data-default-window'));
		if (!Number.isNaN(parsed) && parsed > 0) {
			return parsed;
		}
	}
	return 30;
}

function getInitialReserveId() {
	if (reserveSelect && reserveSelect.value) {
		return reserveSelect.value;
	}
	if (RESERVES.length > 0 && RESERVES[0].reserveId) {
		return RESERVES[0].reserveId;
	}
	return '';
}

function getInitialWindowDays() {
	if (windowSelect) {
		const parsed = Number(windowSelect.value);
		if (!Number.isNaN(parsed) && parsed > 0) {
			return parsed;
		}
	}
	return FALLBACK_WINDOW;
}

function getReserveMeta(reserveId: string) {
	return RESERVES.find((reserve) => reserve.reserveId.toLowerCase() === reserveId.toLowerCase());
}

function getReserveLabel(reserveId: string) {
	const match = getReserveMeta(reserveId);
	return match ? match.label : reserveId || 'Unknown reserve';
}

function rayToPercent(value: number | string | undefined) {
	const numeric = Number(value);
	if (!Number.isFinite(numeric)) return 0;
	return (numeric / 1e27) * 100;
}

function formatPercent(value: number | string | undefined) {
	const numeric = Number(value);
	if (!Number.isFinite(numeric)) return '0%';
	return `${numeric.toFixed(2)}%`;
}

function pruneSamples<T extends { timestamp: number }>(samples: T[], days: number) {
	const cutoff = Date.now() - days * 86400000;
	return samples.filter((sample) => sample.timestamp * 1000 >= cutoff);
}

function coalesceRate(sample: Record<string, unknown>, keys: string[]): string | number | undefined {
	for (const key of keys) {
		const value = sample[key];
		if (value !== undefined && value !== null) {
			return value as string | number;
		}
	}
	return undefined;
}

function normalizeTimestamp(sample: Record<string, unknown>) {
	const candidates = ['timestamp', 'timestampSec'];
	for (const key of candidates) {
		const raw = sample[key];
		if (raw !== undefined && raw !== null) {
			const value = Number(raw);
			if (Number.isFinite(value)) {
				return value;
			}
		}
	}
	const msRaw = sample.timestampMs;
	if (msRaw !== undefined && msRaw !== null) {
		const value = Number(msRaw) / 1000;
		if (Number.isFinite(value)) {
			return value;
		}
	}
	return undefined;
}

function getLastTimestamp(samples: Array<{ timestamp: number }>) {
	if (!samples.length) return undefined;
	return samples[samples.length - 1]?.timestamp;
}

function setStatus(message: string, type: 'info' | 'success' | 'error' = 'info') {
	if (statusEl) {
		statusEl.textContent = message;
		statusEl.dataset.mode = type;
	}
}

async function loadRates(reserveId: string, days: number) {
	if (!canvas || !reserveSelect || !windowSelect) {
		console.error('Chart container or controls not found in DOM');
		return;
	}

	setStatus('Fetching fresh data...');
	const reserveMeta = getReserveMeta(reserveId);
	if (!reserveMeta) {
		setStatus('Unknown reserve selected. Please refresh the page.', 'error');
		return;
	}

	latestReserveLabel = reserveMeta.label;

	try {
		const query = new URLSearchParams({
			poolId: reserveMeta.poolId,
			reserveId: reserveMeta.reserveId,
		});

		const response = await fetchWithTimeout(`${API_BASE_URL}?${query.toString()}`, API_TIMEOUT_MS);
		if (!response.ok) {
			const detail = await readErrorMessage(response);
			const message = detail ? `Aave API responded with ${response.status}: ${detail}` : `Aave API responded with ${response.status}`;
			throw new Error(message);
		}
		const payload = await response.json();
		if (!Array.isArray(payload)) {
			throw new Error('Unexpected payload returned from Aave');
		}
		const series = toChartSeries(payload, days);

		const datasets = [
			{
				label: 'Supply APY',
				data: series.supply,
				borderColor: '#2d7cf7',
				backgroundColor: 'rgba(45,124,247,0.12)',
				tension: 0.25,
				borderWidth: 2,
				fill: true,
			},
			{
				label: 'Variable borrow APY',
				data: series.variable,
				borderColor: '#ff6a3d',
				backgroundColor: 'rgba(255,106,61,0.08)',
				tension: 0.25,
				borderWidth: 2,
				fill: false,
			},
			{
				label: 'Stable borrow APY',
				data: series.stable,
				borderColor: '#8f43ee',
				backgroundColor: 'rgba(143,67,238,0.08)',
				tension: 0.25,
				borderDash: [6, 4],
				borderWidth: 2,
				fill: false,
			},
		];

		if (!chart) {
			chart = new Chart(canvas, {
				type: 'line',
				data: {
					labels: series.labels,
					datasets,
				},
				options: {
					responsive: true,
					maintainAspectRatio: false,
					interaction: { mode: 'index', intersect: false },
					plugins: {
						legend: { display: false },
						tooltip: {
							callbacks: {
								label(ctx) {
									return `${ctx.dataset.label}: ${formatPercent(ctx.parsed.y ?? 0)}`;
								},
							},
						},
					},
					scales: {
						y: {
							title: { display: true, text: 'APY %' },
							grid: { color: 'rgba(255,255,255,0.08)' },
							ticks: {
								callback(value) {
									return `${value}%`;
								},
							},
						},
						x: {
							grid: { display: false },
						},
					},
				},
			});
		} else {
			chart.data.labels = series.labels;
			chart.data.datasets.forEach((dataset, index) => {
				dataset.data = datasets[index].data;
			});
			chart.update();
		}

		if (series.lastTimestamp && updatedEl) {
			updatedEl.textContent = new Date(series.lastTimestamp * 1000).toLocaleString();
		}
		setStatus(`Displaying ${latestReserveLabel} (${days}d window)`, 'success');
	} catch (error) {
		console.error(error);
		const errorMessage = error instanceof Error ? error.message : 'Unable to load rates';
		setStatus(`${errorMessage}. Check your network connection or try again shortly.`, 'error');
	}
}

function wireCustomLoader() {
	if (!customLoadButton) return;
	customLoadButton.addEventListener('click', () => {
		if (!customPoolInput || !customReserveInput || !reserveSelect) return;
		const poolId = customPoolInput.value.trim();
		const reserveId = customReserveInput.value.trim().toLowerCase();
		const label = (customLabelInput?.value.trim() || `${reserveId.slice(0, 6)}… (${poolId})`).trim();

		if (!poolId || !reserveId) {
			setStatus('Provide both poolId and reserve address to load a custom market.', 'error');
			return;
		}
		if (!reserveId.startsWith('0x') || reserveId.length < 10) {
			setStatus('Reserve address should be a valid hex string.', 'error');
			return;
		}

		let meta = getReserveMeta(reserveId);
		if (!meta) {
			meta = { poolId, reserveId, label };
			RESERVES.push(meta);
			const option = document.createElement('option');
			option.value = reserveId;
			option.textContent = label;
			reserveSelect.appendChild(option);
		} else {
			meta.poolId = poolId;
			meta.label = label || meta.label;
			const option = Array.from(reserveSelect.options).find((opt) => opt.value === reserveId);
			if (option) option.textContent = meta.label;
		}

		reserveSelect.value = reserveId;
		customPoolInput.value = '';
		customReserveInput.value = '';
		if (customLabelInput) customLabelInput.value = '';

		const windowDays = Number(windowSelect?.value || DEFAULT_WINDOW);
		loadRates(reserveId, windowDays);
	});
}

type Series = {
	labels: string[];
	supply: number[];
	variable: number[];
	stable: number[];
	lastTimestamp?: number;
};

function toChartSeries(rawData: Array<Record<string, any>>, days: number): Series {
	const sliced = pruneSamples(
		rawData
			.map((sample) => ({
				timestamp: normalizeTimestamp(sample),
				supply: rayToPercent(coalesceRate(sample, ['liquidityRate', 'liquidityAPR', 'liquidityRateRay']) as
					| string
					| number
					| undefined),
				variable: rayToPercent(coalesceRate(sample, ['variableBorrowRate', 'variableBorrowAPR']) as
					| string
					| number
					| undefined),
				stable: rayToPercent(coalesceRate(sample, ['stableBorrowRate', 'stableBorrowAPR']) as
					| string
					| number
					| undefined),
			}))
			.filter(
				(entry): entry is { timestamp: number; supply: number; variable: number; stable: number } =>
					typeof entry.timestamp === 'number',
			),
		days,
	).sort((a, b) => a.timestamp - b.timestamp);

	if (!sliced.length) {
		throw new Error('No samples returned for the selected window. Try a larger range.');
	}

	return {
		labels: sliced.map((entry) =>
			new Date(entry.timestamp * 1000).toLocaleString(undefined, { month: 'short', day: 'numeric' }),
		),
		supply: sliced.map((entry) => entry.supply),
		variable: sliced.map((entry) => entry.variable),
		stable: sliced.map((entry) => entry.stable),
		lastTimestamp: getLastTimestamp(sliced),
	};
}

async function fetchWithTimeout(url: string, timeoutMs: number) {
	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const response = await fetch(url, { signal: controller.signal });
		return response;
	} finally {
		clearTimeout(timeoutId);
	}
}

async function readErrorMessage(response: Response) {
	try {
		const text = await response.text();
		if (!text) return '';
		try {
			const parsed = JSON.parse(text);
			if (parsed && typeof parsed === 'object' && 'message' in parsed) {
				return String(parsed.message);
			}
		} catch {
			// not JSON, fall through
		}
		return text;
	} catch {
		return '';
	}
}
