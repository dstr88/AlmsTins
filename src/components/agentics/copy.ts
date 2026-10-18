/**
 * Every word the Agentics pages say, in one place, so a re-skin or a rename touches this file and
 * the shell, not the components. English only for now (the Agent Vault is owner-only).
 *
 * Almstins verifies, screens, flags and records. These words never say it stops, blocks or holds
 * anything and never call an address safe. They stay with what was asked, what was answered and
 * the raw value that moved.
 */
import { NO_TRANSFERS, NOT_REGISTERED_NOTE, NOTHING_NEEDS_A_PERSON } from '@/lib/agentVault/reportText';

export const copy = {
  brand: 'Agentics',
  nav: { reports: 'Reports' },

  reports: {
    kicker: 'Agent Vault',
    title: 'Reports',
    lede: 'One report per agent for each UTC day. A report is a snapshot of what the Vault had recorded when it was made. The newest version of a day is the one listed here; older versions stay.',
    noAgents: 'No agents yet.',
    noReports: 'No reports yet for this agent.',
    signingOff: 'No signing key is configured on this server. Reports are still made and listed, but they are unsigned, and no signed PDF can be produced until a key is configured.',
    makeTitle: 'Make a report',
    makeDay: 'Day (UTC)',
    makeButton: 'Make report',
    making: 'Making the report',
    todayNote: 'Today gives a partial report: it holds what was recorded up to the moment it is made, and says so.',
    columns: { day: 'Day (UTC)', counts: 'Addresses', moved: 'Bought and sold', made: 'Made' },
  },

  pills: {
    version: (n: number) => `Version ${n}`,
    partial: 'Partial day',
    unsigned: 'Unsigned',
    signed: 'Signed',
  },

  buckets: {
    issues: 'Had issues',
    notConfirmed: 'Not confirmed',
    new: 'New',
    noIssues: 'No issues',
  },

  strip: {
    bought: 'Bought',
    sold: 'Sold',
    none: NO_TRANSFERS,
    withoutValue: (n: number) => `${n} without a USD value (not in the total)`,
    note: 'Raw value in (bought) and out (sold) between the agent\'s wallets and registered destinations, priced at the time of each transfer. The two sides are not compared.',
    statuses: 'Transfers by the verify-status they inherited from the check before them',
    noCheckBefore: (n: number) => `${n} with no check before them`,
  },

  view: {
    kicker: 'Agent Vault',
    title: 'Operator report',
    back: 'All reports',
    partialNote: (at: string) => `Partial day. This report was made at ${at}, before the day ended, so it covers the day up to that moment.`,
    snapshotNote: 'This report is a snapshot. It holds every event the Vault had recorded up to the time it was generated. A transfer is recorded after the chain confirms it, so a later version of this day may list one that this version does not.',
    needsAttention: 'Needs a look',
    nothingNeeds: NOTHING_NEEDS_A_PERSON,
    clearNote: `A clear result means the checks that ran came back without a flag. It is not a statement that an address is safe or legitimate. ${NOT_REGISTERED_NOTE}`,
    listedNote: 'Each address is listed once, in the most severe group any of its checks fell in. The checks in each group are counted by their own answer.',
    omitted: (n: number) => `${n} more counted above but not listed.`,
    noIssuesLine: (checks: string, addresses: string) => `${checks} came back proven or consistent with history. ${addresses} had only such checks and are not listed.`,
    noIssuesNone: 'No check came back proven or consistent with history in this period.',
    columns: { first: 'First (UTC)', address: 'Address', label: 'Label', what: 'What happened', checks: 'Checks' },
    checksOf: (n: number, total: number) => `${n} of ${total}`,
    versionsTitle: 'Versions of this day',
    versionsNote: 'Newest first. Each one is a snapshot made at the time shown.',
    current: 'Shown',
  },

  verification: {
    title: 'Verification',
    verified: 'Signed by Almstins, and the report still matches what was signed.',
    unsigned: 'This report has no signature. It was made when no signing key was configured. Make it again once signing is configured to get a signed copy.',
    unverifiable: 'This report was signed, but the key that signed it is not published right now, so the signature cannot be confirmed. No signed PDF can be produced until it can.',
    altered: 'This report no longer matches what was signed. It is not offered as a signed PDF.',
    recordId: 'Record ID',
    merkleRoot: 'Merkle root',
    signedBy: 'Signed with key',
    generated: 'Generated',
    downloadPdf: 'Download signed PDF',
    downloadBundle: 'Download proof bundle',
    howTo: 'To check a report, upload its proof bundle at the verify page. The check runs in your browser and needs no account. It shows the lines of the report are unaltered and were signed by Almstins. It does not show that anything the report describes was right.',
    verifyLink: 'Verify a record',
  },

  delivery: {
    title: 'Email',
    lede: 'Reports are always made and kept here. Email is off until you turn it on, and goes to the email address on your account.',
    cadenceLabel: 'Report email',
    cadence: {
      off: 'Off',
      daily: 'Every day',
      weekly: 'Every Monday, for the week before',
      issues: 'Only when something needs a look',
    },
    alertsLabel: 'Email me at once when a check on a registered address comes back flagged (at most one an hour for each address)',
    countsOnly: 'Emails carry counts only. Wallet addresses, labels and amounts stay behind your sign-in. Something needs a look when an address had issues or was not confirmed.',
    save: 'Save',
    saving: 'Saving',
    saved: 'Saved.',
    noRecipient: 'No email address is on file for this account, so nothing can be sent.',
  },

  errors: {
    generic: 'Something went wrong. Try again in a moment.',
    invalid_period: 'That day is not available. Pick a day from the day the agent was created up to today.',
    invalid_settings: 'Those settings were not understood. Try again.',
    rate_limited: 'That is a lot of reports in a short time. Wait a minute, then try again.',
    version_limit: 'That day already has the most versions a report can have. The newest version is in the list below.',
    tin_not_found: 'That agent was not found.',
    invalid_id: 'That agent was not found.',
    expected_json: 'Something went wrong. Try again in a moment.',
    server_error: 'Something went wrong. Try again in a moment.',
  } as Record<string, string>,
} as const;
