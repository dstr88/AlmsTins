/**
 * verifyTerms.ts — the vocabulary, defined once.
 *
 * The pilot financier asked for plain-English terminology, and then told us something more
 * useful: he had not read the guide, and would not have read it even with time. So a
 * glossary that lives only in documentation is a glossary nobody reads. These definitions
 * are used by the guide AND by the desk, where the words actually appear next to money.
 *
 * Written in the financier's language, not the data model's, and ordered as they are met
 * in the work rather than alphabetically.
 */

export interface Term { key: string; term: string; def: string }

const RAW: Array<[string, string]> = [
  ['Receivable',
   'Money your client is owed for goods or services already delivered, payable on a date in the future. The invoice is the paper. The receivable is the debt behind it.'],
  ['Face value',
   'The full amount the debtor owes. Not what you advance: you decide that.'],
  ['Client',
   'The company you are financing. He is owed the money and wants it sooner.'],
  ['Debtor',
   'The company that owes the money and will pay it. Your client\u2019s customer, not yours.'],
  ['Receivable ID',
   'The 64-character fingerprint of the record, which is also its address. Unguessable, so holding it is the permission to look. Hand it to another financier and they can check the receivable without an account and without asking you.'],
  ['Claim',
   'Your record that you advanced money against a receivable. It is a statement of something that happened, not a reservation or a request.'],
  ['Register a claim',
   'Writing that record. It is signed, timestamped, and visible to anyone holding the ID, and it consumes headroom so the next lender to check sees it.'],
  ['Headroom, or available',
   'Face value minus every claim still standing. What is left to finance without duplicating an advance somebody else has already made. A claim over the remaining headroom is refused, not warned about.'],
  ['Debtor confirmation',
   'The paying company stating, in its own name, that the debt is real and the amount is right. This is the evidence that does not come from your client, which is what makes it worth the most.'],
  ['Receipt confirmation',
   'Your client stating that your money reached him. Registering a claim costs nothing and anyone with the ID can do it, so a claim is one firm\u2019s word until this exists.'],
  ['Attestation',
   'Any signed statement by a named party about a receivable. Both confirmations are attestations. So is a witness statement, or anything else you choose to record.'],
  ['Dispute',
   'An answer that contradicts the record: the invoice is not theirs, the amount is wrong, the money never arrived. Filed separately from acknowledgments so a disagreement can never be read as agreement.'],
  ['Discharge, or mark repaid',
   'Closing your claim once you have been repaid. The headroom returns, so no dead claim outlives the payment.'],
  ['Settle',
   'The debtor has paid and the receivable is closed. Nothing further can be financed against it.'],
  ['Fingerprint',
   'A SHA-256 hash of a document or a record. Two files with the same fingerprint are the same file. Change one character and it no longer matches, which is how a swapped document becomes provable rather than deniable.'],
  ['Timestamp, or anchor',
   'That fingerprint written into the Bitcoin blockchain. It fixes the date in a ledger nobody controls and nobody can rewind, so the record\u2019s age cannot be forged or backdated. It says the record existed by that block. It says nothing about whether the record is true.'],
];

export const TERMS: Term[] = RAW.map(([term, def]) => ({
  key: term.toLowerCase().split(',')[0].trim().replace(/\s+/g, '-'),
  term,
  def,
}));

/** One definition, by its key. Used by the desk to explain a word in place. */
export function defineTerm(key: string): Term | null {
  return TERMS.find((t) => t.key === key) ?? null;
}
