/**
 * verifyPlans.client.ts: behavior for the /admin Verify plans panel.
 *
 * Markup lives in VerifyPlans.astro, presentation in VerifyPlans.css, every word in
 * verifyPlans.copy.ts. This file touches the DOM only through classes and attributes.
 *
 * An email and a note are typed by people, so every value written into a row goes through
 * escapeHtml, in text and attribute position alike.
 */

import { escapeHtml } from '@/lib/escapeHtml';
import { VERIFY_PLANS, isVerifyPaidPlan } from '@/lib/verifyPlans';
import { VERIFY_PLANS_COPY as copy } from './verifyPlans.copy';

const ENDPOINT = '/api/admin/verify-plan';

interface PlanRow {
	tenantId: string;
	email: string | null;
	plan: string;
	status: string;
	paidThrough: string | null;
	note: string | null;
	createdAt: string | null;
	updatedAt: string | null;
	live: boolean;
	readsAs: string;
	destinations: number;
}

/** The rows on screen, by tenant id, so Edit can fill the form from the row it sits in. */
const shown = new Map<string, PlanRow>();

const todayUtc = () => new Date().toISOString().slice(0, 10);
const planName = (id: string) => (isVerifyPaidPlan(id) ? VERIFY_PLANS[id].name : id === 'free' ? VERIFY_PLANS.free.name : id);
const stateOf = (r: PlanRow): 'live' | 'canceled' | 'ended' => (r.live ? 'live' : r.status === 'canceled' ? 'canceled' : 'ended');

function renderRow(r: PlanRow): string {
	const state = stateOf(r);
	// A live row that Stripe is still retrying shows its own word beside the pill.
	const statusWord = state === 'live' && r.status !== 'active' ? ` <span class="vplans__muted">${escapeHtml(r.status)}</span>` : '';
	const total = r.live && isVerifyPaidPlan(r.plan) ? VERIFY_PLANS[r.plan].limits.total : null;
	const held = total !== null
		? copy.destinationsOf.replace('{n}', String(r.destinations)).replace('{total}', String(total))
		: String(r.destinations);
	return `<tr data-tenant="${escapeHtml(r.tenantId)}">
		<td><span class="vplans__email">${escapeHtml(r.email ?? copy.noEmail)}</span><span class="vplans__tenant">${escapeHtml(r.tenantId)}</span></td>
		<td>${escapeHtml(planName(r.plan))}</td>
		<td><span class="vplans__pill vplans__pill--${state}">${escapeHtml(copy.states[state])}</span>${statusWord}</td>
		<td>${escapeHtml(r.readsAs)}</td>
		<td>${escapeHtml(r.paidThrough ?? copy.noEndDate)}</td>
		<td>${escapeHtml(held)}</td>
		<td class="vplans__note">${escapeHtml(r.note ?? '')}</td>
		<td>${escapeHtml((r.updatedAt ?? r.createdAt ?? '').slice(0, 16))}</td>
		<td><button class="vplans__edit" type="button">${escapeHtml(copy.edit)}</button></td>
	</tr>`;
}

function init(root: HTMLElement) {
	const form = root.querySelector<HTMLFormElement>('.vplans__form')!;
	const account = form.elements.namedItem('account') as HTMLInputElement;
	const plan = form.elements.namedItem('plan') as HTMLSelectElement;
	const paidThrough = form.elements.namedItem('paidThrough') as HTMLInputElement;
	const note = form.elements.namedItem('note') as HTMLInputElement;
	const submit = root.querySelector<HTMLButtonElement>('.vplans__submit')!;
	const status = root.querySelector<HTMLElement>('.vplans__status')!;
	const rows = root.querySelector<HTMLElement>('.vplans__rows')!;
	const empty = root.querySelector<HTMLElement>('.vplans__empty')!;

	const setStatus = (msg: string, kind: 'ok' | 'error' | '' = '') => {
		status.textContent = msg;
		status.classList.toggle('vplans__status--ok', kind === 'ok');
		status.classList.toggle('vplans__status--error', kind === 'error');
	};
	// A signed-out request is answered by the middleware, in its own spelling ("Unauthorized").
	const errorText = (code: unknown) =>
		(copy.errors[String(code).toLowerCase()] ?? copy.errors.unavailable).replace('{n}', String(note.maxLength));

	// Free has no paid-through date, so the field is off while Free is chosen.
	const syncPaidThrough = () => {
		paidThrough.disabled = plan.value === 'free';
		if (paidThrough.disabled) paidThrough.value = '';
	};
	plan.addEventListener('change', syncPaidThrough);
	syncPaidThrough();

	async function load() {
		rows.setAttribute('aria-busy', 'true');
		try {
			const res = await fetch(ENDPOINT);
			const data = await res.json();
			if (!data.ok) throw new Error(String(data.error ?? res.status));
			const list = data.rows as PlanRow[];
			shown.clear();
			list.forEach((r) => shown.set(r.tenantId, r));
			rows.innerHTML = list.map(renderRow).join('');
			empty.textContent = copy.empty;
			empty.hidden = list.length > 0;
		} catch {
			empty.textContent = copy.loadFailed;
			empty.hidden = false;
		} finally {
			rows.setAttribute('aria-busy', 'false');
		}
	}

	rows.addEventListener('click', (e) => {
		const btn = (e.target as Element).closest('.vplans__edit');
		const r = shown.get(btn?.closest<HTMLElement>('tr')?.dataset.tenant ?? '');
		if (!r) return;
		account.value = r.tenantId;
		plan.value = isVerifyPaidPlan(r.plan) ? r.plan : 'free';
		syncPaidThrough();
		// A date that has passed cannot be set again, so the field starts empty for a new one.
		paidThrough.value = !paidThrough.disabled && r.paidThrough && r.paidThrough >= todayUtc() ? r.paidThrough : '';
		note.value = r.note ?? '';
		setStatus('');
		account.focus();
	});

	form.addEventListener('submit', async (e) => {
		e.preventDefault();
		submit.disabled = true;
		submit.textContent = copy.submitting;
		setStatus('');
		try {
			const res = await fetch(ENDPOINT, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ account: account.value, plan: plan.value, paidThrough: paidThrough.value, note: note.value }),
			});
			const data = await res.json().catch(() => null);
			if (!data?.ok) {
				setStatus(errorText(data?.error), 'error');
				return;
			}
			const who = String(data.email ?? data.tenantId);
			const template = !data.changed ? copy.unchanged : data.paidThrough ? copy.doneThrough : copy.done;
			setStatus(
				template.replace('{account}', who).replace('{plan}', planName(String(data.plan))).replace('{date}', String(data.paidThrough ?? '')),
				'ok',
			);
			form.reset();
			syncPaidThrough();
			await load();
		} catch {
			setStatus(errorText('unavailable'), 'error');
		} finally {
			submit.disabled = false;
			submit.textContent = copy.submit;
		}
	});

	void load();
}

const root = document.querySelector<HTMLElement>('.vplans');
if (root) init(root);
