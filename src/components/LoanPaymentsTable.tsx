import React, { useEffect, useState } from 'react';

type LoanPayment = {
	id: string;
	loanId: string;
	paymentDate: string;
	amountUsd: number;
};

type ApiResponse = { ok: boolean; payments?: LoanPayment[]; error?: string };

const usdFormatter = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

export default function LoanPaymentsTable() {
	const [payments, setPayments] = useState<LoanPayment[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let mounted = true;
		const load = async () => {
			try {
				setLoading(true);
				setError(null);
				const res = await fetch('/api/tradfi/loan-payments/all');
				const data = (await res.json()) as ApiResponse;
				if (!data.ok) throw new Error(data.error ?? 'Failed to load payments.');
				if (mounted) setPayments(data.payments ?? []);
			} catch (err) {
				if (mounted) setError(err instanceof Error ? err.message : 'Failed to load payments.');
			} finally {
				if (mounted) setLoading(false);
			}
		};
		load();
		return () => {
			mounted = false;
		};
	}, []);

	const tableWrap: React.CSSProperties = {
		background: 'rgba(8, 12, 22, 0.85)',
		border: '1px solid rgba(255, 255, 255, 0.12)',
		borderRadius: '12px',
		overflow: 'hidden',
	};

	const theadStyle: React.CSSProperties = {
		background: 'rgba(255, 255, 255, 0.05)',
	};

	const thStyle: React.CSSProperties = {
		padding: '0.6rem 1rem',
		textAlign: 'left',
		fontSize: '0.7rem',
		textTransform: 'uppercase',
		letterSpacing: '0.1em',
		color: 'rgba(255, 255, 255, 0.5)',
		fontWeight: 600,
		borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
	};

	const tdStyle: React.CSSProperties = {
		padding: '0.65rem 1rem',
		fontSize: '0.9rem',
		color: '#f5f8ff',
		borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
	};

	const tdMuted: React.CSSProperties = {
		...tdStyle,
		color: 'rgba(255, 255, 255, 0.6)',
	};

	const tdAmount: React.CSSProperties = {
		...tdStyle,
		fontWeight: 600,
		color: '#f7f2eb',
	};

	if (loading) {
		return (
			<p style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.9rem', margin: 0 }}>
				Loading payments…
			</p>
		);
	}

	if (error) {
		return (
			<p
				style={{
					color: '#f87171',
					background: 'rgba(248,113,113,0.08)',
					border: '1px solid rgba(248,113,113,0.3)',
					borderRadius: '8px',
					padding: '0.75rem 1rem',
					fontSize: '0.9rem',
					margin: 0,
				}}
			>
				{error}
			</p>
		);
	}

	if (payments.length === 0) {
		return (
			<p style={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.9rem', margin: 0 }}>
				No payments recorded yet.
			</p>
		);
	}

	return (
		<div style={tableWrap}>
			<table style={{ width: '100%', borderCollapse: 'collapse' }}>
				<thead style={theadStyle}>
					<tr>
						<th style={thStyle}>Date</th>
						<th style={thStyle}>Loan</th>
						<th style={{ ...thStyle, textAlign: 'right' }}>Amount</th>
					</tr>
				</thead>
				<tbody>
					{payments.map((p) => (
						<tr key={p.id}>
							<td style={tdMuted}>{p.paymentDate}</td>
							<td style={tdStyle}>{p.loanId}</td>
							<td style={{ ...tdAmount, textAlign: 'right' }}>{usdFormatter.format(p.amountUsd)}</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}
