/**
 * adminTime.client.ts: shows every admin time in the viewer's own time zone.
 *
 * AdminTime.astro writes each time as <time datetime="…" data-admin-time="datetime|date"> with
 * UTC text. This rewrites the text in the browser's zone, with the zone named in each time, and
 * keeps the UTC text as the hover title. An element marked data-admin-zone gets the line that
 * names the zone for the whole page.
 *
 * The rules are in src/lib/adminTime.ts; this file only walks the page. textContent only, never
 * HTML. A time that cannot be read is left as the server wrote it.
 */
import { adminTimeLocalText, adminZoneNote, type AdminTimeMode } from '@/lib/adminTime';

function showLocalTimes(root: ParentNode = document): void {
	for (const el of root.querySelectorAll<HTMLTimeElement>('time[data-admin-time]')) {
		if (el.dataset.adminTimeDone) continue;
		const mode: AdminTimeMode = el.dataset.adminTime === 'date' ? 'date' : 'datetime';
		const local = adminTimeLocalText(el.dateTime, mode);
		if (!local) continue;
		const utc = el.textContent?.trim() ?? '';
		// A day alone carries no zone in its text, so its hover shows the full local time too.
		const full = mode === 'date' ? adminTimeLocalText(el.dateTime, 'datetime') : null;
		el.title = [full, utc].filter(Boolean).join(' · ');
		el.textContent = local;
		el.dataset.adminTimeDone = '1';
	}
	for (const el of root.querySelectorAll<HTMLElement>('[data-admin-zone]')) {
		el.textContent = adminZoneNote();
	}
}

showLocalTimes();
