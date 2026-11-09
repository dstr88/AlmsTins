import { describe, it, expect, vi } from 'vitest';

// Pure modules only, but checkLog.ts and report.ts import the store, which opens the database pool
// at module load. Nothing here may touch it.
vi.mock('@/lib/db', () => ({
  db: {
    execute: async () => { throw new Error('this test touches no database'); },
    batch: async () => { throw new Error('this test touches no database'); },
  },
}));

import { deriveAnswer } from '../../src/lib/agentVault/checkLog';
import { ALERT_KINDS, alertKindOf } from '../../src/lib/agentVault/alerts';
import { summarizeChecks, nextTrustStatus, parseReadout } from '../../src/lib/agentVault/trustPolicy';
import { ANSWER_BASES } from '../../src/lib/agentVault/report';
import { reasonText } from '../../src/lib/agentVault/reportText';
import { getAgentReportEmail } from '../../src/i18n/emails/agentReport';
import { copy } from '../../src/components/agentics/copy';
import { walletResult } from '../helpers/agentVault';

/**
 * What the Agent Vault does with a destination two accounts stand behind (the check API's
 * `reason: 'disputed'`, from the cross-account guard in src/lib/verifyMirrorGuard.ts). The Vault's
 * four public answer words do not change; the dispute arrives as its own input and becomes an
 * `unknown` that the owner's list cannot clear, with a basis of its own, an alert of its own, and a
 * pending readout at add time.
 */

describe('deriveAnswer with a disputed destination', () => {
  it('answers unknown, basis destination_disputed, never cleared, whatever the registry says short of flagged', () => {
    for (const status of ['proven', 'mismatch', 'unanchored', 'unknown'] as const) {
      for (const registry of ['trusted', 'pending', 'none'] as const) {
        for (const checkedBefore of [true, false]) {
          const d = deriveAnswer({ status, registry, checkedBefore, disputed: true });
          const label = `${status}/${registry}/${checkedBefore}`;
          if (status === 'mismatch') {
            expect(d.answer, label).toBe('flagged'); // the loudest signal still wins
          } else {
            expect(d, label).toEqual({ answer: 'unknown', basis: 'destination_disputed', cleared: false, history: 'none' });
          }
        }
      }
    }
  });

  it('a registry flag and a screening hit still outrank the dispute: a flag is a ratchet', () => {
    expect(deriveAnswer({ status: 'unknown', registry: 'flagged', checkedBefore: true, disputed: true }).basis).toBe('registry_flagged');
    expect(deriveAnswer({ status: 'unknown', registry: 'trusted', checkedBefore: true, screening: 'fail', disputed: true }).basis).toBe('screening_flagged');
  });

  it('without the input nothing changes: the table reads as before', () => {
    expect(deriveAnswer({ status: 'unknown', registry: 'trusted', checkedBefore: true })).toEqual({ answer: 'consistent-with-history', basis: 'registered_and_checked_before', cleared: true, history: 'consistent' });
    expect(deriveAnswer({ status: 'unknown', registry: 'trusted', checkedBefore: true, disputed: false }).basis).toBe('registered_and_checked_before');
  });
});

describe('the alert and the report know the new basis', () => {
  it('has its own alert kind, emailed whatever the public status, and the email names no address', () => {
    expect(ALERT_KINDS).toContain('disputed');
    for (const status of ['proven', 'mismatch', 'unanchored', 'unknown']) expect(alertKindOf('destination_disputed', status)).toBe('disputed');
    const mail = getAgentReportEmail('en').alert({ appBase: 'https://almstins.com', kind: 'disputed', tinId: 'tin-1' });
    expect(mail.subject).toContain('Disputed');
    expect(mail.text).toContain('two Almstins accounts');
    expect(mail.text).not.toMatch(/0x[0-9a-f]{40}/i);
  });

  it('the report buckets it as a known basis with its own sentence, never as other', () => {
    expect(ANSWER_BASES).toContain('destination_disputed');
    expect(reasonText('destination_disputed')).toMatch(/^Disputed\./);
    expect(reasonText('destination_disputed')).not.toBe(reasonText('other'));
  });
});

describe('the add-time trust check reads a disputed level as pending, never trusted', () => {
  const AT = '2026-11-08T12:00:00.000Z';

  it('is Limited with the verify row reading disputed, not a hit and not a pass', () => {
    const r = summarizeChecks({ wallet: walletResult(), verify: { level: 'disputed', domain: null, claimedElsewhere: true }, checkedAt: AT });
    expect(r.result).toBe('limited');
    expect(r.verify).toBe('disputed');
    expect(r.hits).toEqual([]);
    expect(r.limits).toEqual([]);
    expect(r.provenBy).toBeNull();
    expect(nextTrustStatus(null, r)).toBe('pending');
    expect(nextTrustStatus('trusted', r)).toBe('pending');
  });

  it('a stored readout with the disputed state parses, and the readout has a sentence for it', () => {
    const r = summarizeChecks({ wallet: walletResult(), verify: { level: 'disputed', domain: null, claimedElsewhere: false }, checkedAt: AT });
    expect(parseReadout(JSON.stringify(r))).toEqual(r);
    expect(copy.readout.verify.disputed).toMatch(/two accounts/i);
  });
});
