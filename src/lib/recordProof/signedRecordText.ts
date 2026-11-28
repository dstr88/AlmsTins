// How the public verify page (/verify-record) describes a signed record proof file (the
// receivables download). Pure and isomorphic, so the page can import it. The Year Summary and
// Agent Vault wording lives in manifestText.ts and the component; this is only the receivables file.

import type { SignedRecordCode } from './signedRecord';
import type { Verdict } from './verify';

/** Where a stranger can read the offline steps (the repository is public). */
export const OFFLINE_STEPS_URL = 'https://github.com/dstr88/AlmsTins/blob/production/docs/verify-without-almstins.md';

export const SIGNED_RECORD_VERDICT: Record<Verdict, { icon: string; title: string; cls: 'ok' | 'warn' | 'err' }> = {
  verified:     { icon: '✅', title: 'Genuine, unaltered Almstins record', cls: 'ok' },
  unverifiable: { icon: '⚠️', title: 'Intact, but origin not confirmed',    cls: 'warn' },
  tampered:     { icon: '❌', title: 'Does not verify: altered or corrupt', cls: 'err' },
};

export const SIGNED_RECORD_DETAIL: Record<SignedRecordCode, string> = {
  ok: 'The record hashes to its fingerprint, and the signature is valid under the published Almstins key.',
  digest_mismatch: 'The record does not hash to the fingerprint in the file, so something in it was changed.',
  anchor_mismatch: 'The Bitcoin proof in the file is for a different fingerprint than this record.',
  key_mismatch: 'The file names a published Almstins key but carries a different public key.',
  bad_signature: 'The signature does not match the record under the published key.',
  unknown_key: 'Signed, but with a key id not in the published key list (paste the key, or it may be rotated or forged).',
  unsigned: 'No signature in the file. The record is intact, but nothing says Almstins made it.',
  malformed: 'This file is not a valid Almstins record proof file.',
};

const KIND_LABEL: Record<string, string> = {
  receivable: 'Receivable',
  claim: 'Financing claim',
  attestation: 'Confirmation or dispute',
  reverification: '"Verify now" check',
  claim_discharge: 'Claim released',
  settlement: 'Settlement',
  status_event: 'Status update',
  email_statement: 'Statement of emails about a claim',
};

/** The record's kind in words, or its own tag for a kind this code does not know. */
export function signedRecordKindLabel(kind: unknown): string {
  const k = typeof kind === 'string' ? kind : '';
  return KIND_LABEL[k] ?? (k || 'Record');
}

/** What the file says about its Bitcoin timestamp. Only the reader's own `ots verify` decides it. */
export function bitcoinLine(anchor: { bitcoin_time: string | null } | null | undefined): string {
  if (!anchor) return 'None in this file';
  if (anchor.bitcoin_time) return `Present. The file says Bitcoin confirmed it at ${anchor.bitcoin_time}; check that yourself with ots verify.`;
  return 'Present, not yet confirmed in Bitcoin when this file was made';
}

export const SIGNED_RECORD_INTRO =
  'A receivables proof file: one signed record and its Bitcoin timestamp.';

export const SIGNED_RECORD_NOT_CHECKED =
  'Not checked here: the Bitcoin proof itself, and whether the signing key was ever revoked. Both are in the offline steps.';
