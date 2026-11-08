/**
 * Copy for the receivables plan (tier T1): the plan line on the desk, the one-sentence definition
 * of a contract, and the two refusals the claim and seal writes can answer (409 plan_limit, 409
 * free_plan_locked). Pure and import-free, like the other copy modules.
 *
 * Verbs: holds, records, releases, closes, moves. A limit is a door, not a sweep: nothing here
 * says blocked, banned, penalty or delinquent, and the lock names the dated facts on the record
 * (two claims not maintained past their promised dates), never a judgment of the banker.
 */

export const PLAN_FREE_LABEL = 'Free';
export const PLAN_STANDARD_LABEL = 'Standard';
export const PLAN_UNLIMITED_LABEL = 'Unlimited';

/** {used} of {limit} contracts on the {plan} plan. The owner's account has no limit. */
export const PLAN_LINE = '{used} of {limit} contracts on the {plan} plan';
export const PLAN_LINE_UNLIMITED = 'No contract limit on this account';

/** What a contract is, in one sentence. Same words on the desk and the landing page. */
export const CONTRACT_DEFINITION = 'A contract is one open record: a financing you have recorded and not yet released, or a project you have sealed and not yet closed.';

/** The landing page's price line (T3 replaces the pilot wording with this). */
export const LANDING_PRICE = 'Free: one contract at a time. $95 a month for ten.';

// 409 plan_limit
export const PLAN_LIMIT_FREE = 'This account holds one open contract. Release it, close it, or move to Standard to record another.';
export const PLAN_LIMIT_STANDARD = 'This account holds ten open contracts, the Standard limit. Release or close one to record another.';

// 409 free_plan_locked. {dates} is either empty or " (date, date)".
export const FREE_PLAN_LOCKED = 'Two claims on this account passed their promised dates and were not maintained for six months{dates}. The free plan records no new contracts until the account moves to Standard.';
