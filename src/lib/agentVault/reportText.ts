/**
 * The words of an operator report, in one place, so the Reports page and the signed PDF can never
 * describe the same thing two ways. English only for now: the Agent Vault is owner-only and its
 * surfaces are not translated yet.
 *
 * Almstins verifies, screens, flags and records. These words never say it stops, blocks or holds
 * anything, and they never call an address safe: a clear result means the checks that ran came
 * back without a flag, nothing more.
 */
import type { ReportBucket } from './report';

export const BUCKET_TITLE: Record<ReportBucket, string> = {
  issues: 'Had issues',
  not_confirmed: 'Not confirmed',
  new: 'New',
  no_issues: 'No issues',
};

/** One line under each bucket's title: what puts an address there. */
export const BUCKET_MEANING: Record<ReportBucket, string> = {
  issues: 'Flagged: the registry flagged the address, or its proof is on a different domain than the agent expected.',
  not_confirmed: 'Unknown: the address is not in the registry, or is in it but its checks have not finished. A swapped address shows up here.',
  new: 'First check of a registered, trusted address. Its history baseline started; future checks are compared with it.',
  no_issues: 'Proven, or consistent with the address\'s own history. Counted here, never listed.',
};

/** Why a check landed where it did, by the reason code the tin recorded. */
const REASON: Record<string, string> = {
  registry_flagged: 'Flagged. The address is flagged in your registry. A person should review it.',
  domain_mismatch: 'Flagged. Its proof is on a different domain than the agent expected. A person should review it.',
  not_in_registry: 'Not in your registry. The agent asked about an address that is not on its list.',
  registry_pending: 'In your registry, but its checks have not finished.',
  domain_proof: 'Proven by a domain proof.',
  registered_and_checked_before: 'Registered, and checked before. Consistent with history.',
  registered_first_check: 'First check of a registered address. History baseline started.',
  other: 'Reason not recorded.',
};

export function reasonText(code: string): string {
  return REASON[code] ?? REASON.other;
}

export const VERIFY_STATUS_TITLE: Record<string, string> = {
  proven: 'Proven',
  'consistent-with-history': 'Consistent with history',
  flagged: 'Flagged',
  unknown: 'Unknown',
};
