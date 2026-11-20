/**
 * The business page for Almstins Verify (/verify/business, /verify/business/es, /verify/business/fr):
 * everything on it that is not a word. The words are in src/i18n/verifyBusiness.ts; the markup is
 * in src/components/verifyBusiness/.
 *
 * Every fact the page states is read from the module that enforces it, so the page cannot say
 * one number while the product does another:
 *   - plan names, prices and sizes     src/lib/verifyPlans.ts
 *   - where the proof file is hosted   src/lib/verifyProof.ts (WELL_KNOWN_PATH)
 *   - the satoshi test's networks      src/lib/verifyTestAmount.ts over src/lib/chains.ts
 *   - the scanner's result titles      src/i18n/verifyScan.ts
 * Two facts have no constant to read, so they are stated here and pinned by
 * tests/verify/businessPage.test.ts to the files that decide them: the re-check interval (the
 * cron line of .github/workflows/verify-monitor.yml) and the four answers of the check
 * (src/pages/api/verify/check.ts, documented on /agentics/docs).
 *
 * verifyBusinessPage(lang) returns the page ready to render: the copy with its placeholders
 * filled, plus the lists the components take.
 */

import type { Lang } from '@/lib/i18n/locale';
import { CHAINS, VERIFY_ADDRESS_RAILS } from '@/lib/chains';
import { canonicalUrl } from '@/lib/seo/canonical.mjs';
import { VERIFY_PLANS, type VerifyPaidPlanId, type VerifyPlanId } from '@/lib/verifyPlans';
import { WELL_KNOWN_PATH } from '@/lib/verifyProof';
import { testAmountSpec } from '@/lib/verifyTestAmount';
import { verifyScanCopy, type ScanLang } from '@/i18n/verifyScan';
import { verifyBusinessCopy, type CheckAnswer, type ProofStepCopy, type ReaderCopy, type VerifyBusinessCopy } from '@/i18n/verifyBusiness';

/** The page's three routes, in the order the language switch lists them. */
export const VERIFY_BUSINESS_LANGS: ReadonlyArray<{ code: Lang; href: string; label: string; aria: string }> = [
  { code: 'en', href: '/verify/business', label: 'EN', aria: 'View in English' },
  { code: 'es', href: '/verify/business/es', label: 'ES', aria: 'Ver en español' },
  { code: 'fr', href: '/verify/business/fr', label: 'FR', aria: 'Voir en français' },
];

/** The free scanner: check an address, a payment link or a QR with no account. */
export const SCANNER_HREF = '/verify/scan';
/** The Verify sign-in, returning to the Verify dashboard. A first sign-in creates the free account. */
export const VERIFY_SIGNIN_HREF = '/verify/login?next=/dashboard/verify';
/** The check, documented for the people wiring agents and payment systems. */
export const AGENT_DOCS_HREF = '/agentics/docs';
export const AGENTICS_HREF = '/agentics';

/** The one action for each reader, in the page's order: the business, the payer, the agent operator. */
export const READER_HREFS = [VERIFY_SIGNIN_HREF, SCANNER_HREF, AGENT_DOCS_HREF] as const;

/** The shop-facing Verify page and the prices page, in the visitor's language. */
const SHOP_HREF: Record<Lang, string> = { en: '/verify', es: '/verify/es', fr: '/verify/fr' };
const PRICES_HREF: Record<Lang, string> = { en: '/prices', es: '/prices/es', fr: '/prices/fr' };

/** The mailbox that arranges the Business and Pro plans (the same one the dashboard's plan notice names). */
export const PLANS_EMAIL = 'support@almstins.com';
const PLANS_MAILTO = `mailto:${PLANS_EMAIL}?subject=${encodeURIComponent('Almstins Verify: Business or Pro plan')}`;

/** How often Almstins re-checks a domain proof, in hours. */
export const MONITOR_EVERY_HOURS = 6;

/** The language the scanner page renders in today, whatever the visitor's language. */
export const SCANNER_RENDERS_IN: ScanLang = 'en';

/** The four answers of the check, with the tone each card takes (the same tones as /agentics/docs). */
export const CHECK_ANSWERS: ReadonlyArray<{ code: CheckAnswer; cls: 'good' | 'bad' | 'warn' }> = [
  { code: 'proven', cls: 'good' },
  { code: 'mismatch', cls: 'bad' },
  { code: 'unanchored', cls: 'warn' },
  { code: 'unknown', cls: 'warn' },
];

/** The networks the satoshi test works on, by name. */
export function selfSendNetworks(): string[] {
  return VERIFY_ADDRESS_RAILS.filter((chain) => testAmountSpec(chain) !== null).map((chain) => CHAINS[chain].name);
}

/** What the copy's placeholders stand for. */
export function verifyBusinessFacts(): Record<string, string> {
  const free = VERIFY_PLANS.free.limits;
  return {
    address: String(free.address),
    qr: String(free.qr),
    hours: String(MONITOR_EVERY_HOURS),
    path: WELL_KNOWN_PATH,
    networks: selfSendNetworks().join(', '),
    email: PLANS_EMAIL,
  };
}

/** Replace each {key} that `vars` knows. A placeholder it does not know is left as it is. */
export function fill(text: string, vars: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (whole, key: string) => (key in vars ? vars[key] : whole));
}

function fillDeep<T>(value: T, vars: Record<string, string>): T {
  if (typeof value === 'string') return fill(value, vars) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => fillDeep(v, vars)) as unknown as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fillDeep(v, vars)])) as unknown as T;
  }
  return value;
}

export interface ReaderCard extends ReaderCopy { href: string }
export interface ProofStep extends ProofStepCopy { note?: string }
export interface ScanResult { id: 'verified' | 'claimed' | 'unproven'; tone: 'good' | 'warn' | 'plain'; title: string; body: string }
export interface AnswerCard { code: CheckAnswer; cls: 'good' | 'bad' | 'warn'; h: string; p: string }
export interface PlanCard {
  id: VerifyPlanId;
  name: string;
  price: string;
  unit: string;
  /** The yearly price line; null on the Free plan. */
  yearly: string | null;
  items: string[];
  cta: string;
  href: string;
}

/** The three plan cards, Free first. Names, prices and sizes of the paid plans come from VERIFY_PLANS. */
export function planCards(t: VerifyBusinessCopy): PlanCard[] {
  const money = (usd: number) => t.plans.paid.money.replace('{n}', usd.toLocaleString(t.lang));
  const paid = (['business', 'pro'] as const satisfies readonly VerifyPaidPlanId[]).map((id): PlanCard => {
    const plan = VERIFY_PLANS[id];
    return {
      id,
      name: plan.name,
      price: money(plan.monthlyUsd),
      unit: t.plans.paid.unit,
      yearly: t.plans.paid.yearly.replace('{price}', money(plan.yearlyUsd)),
      items: t.plans.paid.items.map((item) => item.replace('{n}', String(plan.limits.total))),
      cta: t.plans.paid.cta,
      href: PLANS_MAILTO,
    };
  });
  const free: PlanCard = {
    id: 'free',
    name: t.plans.free.name,
    price: t.plans.free.price,
    unit: t.plans.free.unit,
    yearly: null,
    items: t.plans.free.items,
    cta: t.plans.free.cta,
    href: VERIFY_SIGNIN_HREF,
  };
  return [free, ...paid];
}

export interface VerifyBusinessPageModel {
  /** The copy, with every placeholder but the paid plans' own ({n}, {price}) filled. */
  t: VerifyBusinessCopy;
  canonical: string;
  readers: ReaderCard[];
  steps: ProofStep[];
  /** The scanner's own titles, in the language the scanner renders in, with this page's explanation. */
  scan: { titleLang: ScanLang; results: ScanResult[] };
  answers: AnswerCard[];
  plans: PlanCard[];
  links: { scanner: string; signin: string; agentDocs: string; agentics: string; shop: string; prices: string };
}

/** The page for one language, ready to render. */
export function verifyBusinessPage(lang: Lang): VerifyBusinessPageModel {
  const t = fillDeep(verifyBusinessCopy[lang], verifyBusinessFacts());
  const here = VERIFY_BUSINESS_LANGS.find((l) => l.code === lang) ?? VERIFY_BUSINESS_LANGS[0];
  const scanner = verifyScanCopy[SCANNER_RENDERS_IN];
  return {
    t,
    canonical: canonicalUrl(here.href),
    readers: t.readers.items.map((reader, i) => ({ ...reader, href: READER_HREFS[i] })),
    steps: t.prove.steps.map((step, i) => (i === 0 ? { ...step, note: t.prove.networks } : step)),
    scan: {
      titleLang: SCANNER_RENDERS_IN,
      results: [
        { id: 'verified', tone: 'good', title: scanner.verifiedTitle, body: t.payer.results.verified },
        { id: 'claimed', tone: 'warn', title: scanner.claimedTitle.address, body: t.payer.results.claimed },
        { id: 'unproven', tone: 'plain', title: scanner.notVerifiedTitle, body: t.payer.results.unproven },
      ],
    },
    answers: CHECK_ANSWERS.map(({ code, cls }) => ({ code, cls, ...t.agent.answers[code] })),
    plans: planCards(t),
    links: {
      scanner: SCANNER_HREF,
      signin: VERIFY_SIGNIN_HREF,
      agentDocs: AGENT_DOCS_HREF,
      agentics: AGENTICS_HREF,
      shop: SHOP_HREF[lang],
      prices: PRICES_HREF[lang],
    },
  };
}
