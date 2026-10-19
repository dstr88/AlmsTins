/**
 * Asking for an export from the browser and handing the file to the person. The request is a plain
 * GET to the Vault's own endpoint (/api/agentics/export); a failure arrives as a code and ends in the
 * export card's own plain words, so a refused range reads "narrow the range" and not a page of JSON.
 *
 * `fetch` is a parameter so every rule here is a unit test with no network.
 */
import { addDays } from '@/lib/agentVault/report';
import { copy } from './copy';
import { errorText } from './errors';

export interface ExportParams {
  tinId: string;
  /** The first and last UTC day, `YYYY-MM-DD`, both counted. */
  from: string;
  to: string;
  format: 'json' | 'csv';
}

/** The address of an export. Every part is encoded, so a value can never change the path or the query. */
export function exportUrl(p: ExportParams): string {
  return `/api/agentics/export?tinId=${encodeURIComponent(p.tinId)}&from=${encodeURIComponent(p.from)}&to=${encodeURIComponent(p.to)}${p.format === 'csv' ? '&format=csv' : ''}`;
}

/** The first day of "the last `days` days" ending on `today`: 7 days ending today starts six days back. Never before `since`. */
export function presetRange(today: string, days: number, since: string): { from: string; to: string } {
  const from = addDays(today, -(days - 1));
  return { from: since && from < since ? since : from, to: today };
}

const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,200}$/;

/** The file name the server chose (Content-Disposition), when it is a plain one; otherwise the fallback. Nothing else from the header is used. */
export function filenameFrom(disposition: string | null, fallback: string): string {
  const m = /filename="([^"]*)"/i.exec(disposition ?? '');
  return m && SAFE_NAME.test(m[1]) ? m[1] : fallback;
}

/** What a refused export says, in the card's own words: its own line for the codes it has one for, else the general one. */
export function exportErrorText(code: unknown): string {
  return typeof code === 'string' && Object.prototype.hasOwnProperty.call(copy.export.errors, code) ? copy.export.errors[code] : errorText(code);
}

export type ExportResult = { ok: true; blob: Blob; filename: string } | { ok: false; message: string };

/** Asks for the file. A dropped connection, a refusal and a body that is not a file all end in a message, never a thrown error. */
export async function requestExport(p: ExportParams, fetchFn: typeof fetch = fetch): Promise<ExportResult> {
  let res: Response;
  try {
    res = await fetchFn(exportUrl(p), { credentials: 'same-origin' });
  } catch {
    return { ok: false, message: errorText('network') };
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
    return { ok: false, message: exportErrorText(body?.error) };
  }
  try {
    const blob = await res.blob();
    return { ok: true, blob, filename: filenameFrom(res.headers.get('Content-Disposition'), `almstins-agent-ledger.${p.format === 'csv' ? 'csv' : 'json'}`) };
  } catch {
    return { ok: false, message: errorText('network') };
  }
}

/** Hands a file to the person through the browser's own download. Browser only. */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
