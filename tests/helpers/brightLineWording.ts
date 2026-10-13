/**
 * The wording rules every piece of receivables copy is held to (plan convention 6). A copy test
 * passes its strings to brightLineViolations() and expects an empty list.
 *
 *   - Never stops a payment: the two patterns from tests/verify/agentDocs.test.ts (Verify warns
 *     and flags; the person decides). agentDocs.test.ts keeps its own copy and stays as is.
 *   - Active voice: Almstins never says it stops, blocks, refuses, mints or transfers anything.
 *   - Lending: copy never refuses, rejects or blocks a claim, an advance, financing or a record.
 *   - Collateral (owner guardrail, Oct 10): the registry is a voluntary record, not a collateral
 *     registry, so copy never says or implies a lien, perfection, priority or a registered
 *     security interest. Say "on record at Almstins" or "recorded as financed".
 *   - American English: common British spellings.
 */

export interface WordingRule {
	rule: string;
	pattern: RegExp;
}

export const BRIGHT_LINE_RULES: readonly WordingRule[] = [
	{ rule: 'never stops a payment', pattern: /\b(do not|don't|never|must not)\s+(pay|send)\b/i },
	{ rule: 'never stops a payment', pattern: /\b(stop|block|halt|reject|refuse|abort|cancel)s?\s+(the |this |a )?(payment|transaction|transfer)/i },
	{ rule: 'active voice', pattern: /\b(we|almstins)\s+(stop|block|halt|refuse|reject|prevent|mint|transfer)s?\b/i },
	{ rule: 'lending', pattern: /(refuse|reject|deny|block|cannot)\w*\s+(the |this |a )?(claim|advance|financing|record|loan)/i },
	{ rule: 'collateral', pattern: /\bliens?\b/i },
	{ rule: 'collateral', pattern: /\bperfect(ed|ion)\b/i },
	{ rule: 'collateral', pattern: /\bpriorit(y|ies)\b/i },
	{ rule: 'collateral', pattern: /\bfirst[\s-]+in[\s-]+line\b/i },
	{ rule: 'collateral', pattern: /\bregistered\s+security\s+interests?\b/i },
	{
		rule: 'American English',
		pattern: /\b(organi|recogni|authori|reali|minimi|maximi|apologi|finali|summari|categori|customi|optimi|standardi|utili|digiti|capitali|normali|tokeni|characteri|memori|prioriti|emphasi)s(e|ed|es|ing|ation|ations)\b/i,
	},
	{
		rule: 'American English',
		pattern: /\b(colours?|favour\w*|honour\w*|labour\w*|behaviour\w*|neighbour\w*|endeavour\w*|rumour\w*|humour\w*|centres?|licences?|cheques?|catalogues?|programmes?|defence|offence|analys(e|ed|es|ing)|cancell(ed|ing)|travell(ed|ing)|labell(ed|ing)|modell(ed|ing)|enrolment|fulfil|fulfilment|judgement|acknowledgements?|instalments?|whilst|amongst|learnt|spelt)\b/i,
	},
];

/** Every rule the text breaks, as "rule: matched text". Empty when the text is clean. */
export function brightLineViolations(text: string): string[] {
	const out: string[] = [];
	for (const { rule, pattern } of BRIGHT_LINE_RULES) {
		const m = text.match(pattern);
		if (m) out.push(`${rule}: ${m[0]}`);
	}
	return out;
}
