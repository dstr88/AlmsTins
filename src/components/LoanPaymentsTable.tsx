import React, { useEffect, useState } from 'react';
import { getClientLang } from '@/lib/i18n/clientLang';
import { getLoanPaymentsTable } from '@/i18n/components/loanPaymentsTable';

type LoanPayment = {
	id: string;
	loanId: string;
	paymentDate: string;
	amountUsd: number;
};

type ApiResponse = { ok: boolean; payments?: LoanPayment[]; error?: string };

const usdFormatter = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

export default function LoanPaymentsTable() {
	const t = getLoanPaymentsTable(getClientLang());
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
				if (!data.ok) throw new Error(data.error ?? t.errorFallback);
				if (mounted) setPayments(data.payments ?? []);
			} catch (err) {
				if (mounted) setError(err instanceof Error ? err.message : t.errorFallback);
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
		background: 'var(--surface-bg)',
		border: '1px solid var(--border-bright)',
		borderRadius: '12px',
		overflow: 'hidden',
	};

	const theadStyle: React.CSSProperties = {
		background: 'var(--border-subtle)',
	};

	const thStyle: React.CSSProperties = {
		padding: '0.6rem 1rem',
		textAlign: 'left',
		fontSize: '0.7rem',
		textTransform: 'uppercase',
		letterSpacing: '0.1em',
		color: 'var(--text-muted)',
		fontWeight: 600,
		borderBottom: '1px solid var(--border-bright)',
	};

	const tdStyle: React.CSSProperties = {
		padding: '0.65rem 1rem',
		fontSize: '0.9rem',
		color: 'var(--text-primary)',
		borderBottom: '1px solid var(--border-subtle)',
	};

	const tdMuted: React.CSSProperties = {
		...tdStyle,
		color: 'var(--text-muted)',
	};

	const tdAmount: React.CSSProperties = {
		...tdStyle,
		fontWeight: 600,
		color: 'var(--text-primary)',
	};

	if (loading) {
		return (
			<p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', margin: 0 }}>
				{t.loading}
			</p>
		);
	}

	if (error) {
		return (
			<p
				style={{
					color: 'var(--loss)',
					background: 'var(--loss-bg)',
					border: '1px solid var(--loss-border)',
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
			<p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', margin: 0 }}>
				{t.empty}
			</p>
		);
	}

	return (
		<div style={tableWrap}>
			<table style={{ width: '100%', borderCollapse: 'collapse' }}>
				<thead style={theadStyle}>
					<tr>
						<th style={thStyle}>{t.colDate}</th>
						<th style={thStyle}>{t.colLoan}</th>
						<th style={{ ...thStyle, textAlign: 'right' }}>{t.colAmount}</th>
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
