/**
 * incomeKinds.ts — the single source of truth for which import_transactions
 * `kind` values are taxable ordinary income (staking, interest, rewards,
 * cashback, referrals, reimbursements). Extracted into its own module so both
 * the tax breakdown and the price backfill can share it without an import cycle.
 */
export const INCOME_KINDS = new Set([
  'crypto_earn_interest_paid',
  'Staking Income',
  'referral_card_cashback',
  'referral_bonus',
  'referral_gift',
  'reward.loyalty_program.trading_rebate.crypto_wallet',
  'reward.external_cashback.crypto_card.payment',
  'admin_wallet_credited',
  'pay_checkout_reward',
  'dynamic_coin_swap_bonus_earn_deposit',
  'lockup_swap_rebate',
  'reimbursement',
]);
