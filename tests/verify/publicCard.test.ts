import { describe, it, expect } from 'vitest';
import {
  addressSafetyVerdict,
  displayableName,
  fillTemplate,
  onSharedHost,
  publicPublisher,
  publicVerifyCard,
  publisherText,
  safetyFlagged,
  splitTip,
  type PublicVerifyLookup,
} from '../../src/lib/verifyPublicCard';
import { en as wcEn, es as wcEs, fr as wcFr } from '../../src/i18n/walletChecker';
import { en as dashEn, es as dashEs, fr as dashFr } from '../../src/i18n/dashboard/verify';
import { verifyScanCopy, type ScanNoun } from '../../src/i18n/verifyScan';

/**
 * Public Verify cards (wallet-checker and /verify/scan).
 *
 * Bug: a Claimed wallet (self-send only) showed its freeform label as the publisher:
 * "A verified Almstins member registered this address as {name}" and "{label} proved
 * control". Any label goes through ("Coinbase Support"), so this let anyone impersonate a
 * brand on the most-used public page, and could publish a person's name next to a wallet.
 * Also, a green Verified could sit next to a danger verdict.
 */

// Merchant hits by default: the lookup's domain is the account's verified-name domain,
// not necessarily the one listing the address, so the card says "verified via".
const hit = (over: Partial<PublicVerifyLookup>): PublicVerifyLookup => ({
  level: 'verified', since: '2026-09-01', domain: null, label: null, source: 'merchant', ...over,
});
const via = (domain: string, name: string | null = null) => ({ name, domain, listed: false });

describe('a freeform label is never a publisher', () => {
  it('Claimed shows no name and no domain, whatever the lookup carried', () => {
    const lookup = hit({ level: 'claimed', label: 'Coinbase Support', domain: 'coinbase.com' });
    expect(publicPublisher(lookup)).toBeNull();
    const card = publicVerifyCard(lookup, 'clean');
    expect(card?.publisher).toBeNull();
    expect(JSON.stringify(card)).not.toContain('Coinbase');
  });

  it('Verified with a label that does not derive from the domain shows the domain only', () => {
    expect(publicPublisher(hit({ label: 'Coinbase Support', domain: 'joescoffee.com' })))
      .toEqual(via('joescoffee.com'));
    expect(publicPublisher(hit({ label: 'Jane Doe', domain: 'joescoffee.com' })))
      .toEqual(via('joescoffee.com'));
  });

  it('Verified with a business name derived from the domain shows the name', () => {
    expect(publicPublisher(hit({ label: "Joe's Coffee", domain: 'joescoffee.com' })))
      .toEqual(via('joescoffee.com', "Joe's Coffee"));
  });

  it('a lookalike domain does not unlock the brand name', () => {
    expect(publicPublisher(hit({ label: 'Starbucks', domain: 'starbucks-pay.com' })))
      .toEqual(via('starbucks-pay.com'));
  });

  it('an entity (exchange) listing is "listed on" its own domain; a merchant hit is "verified via"', () => {
    expect(publicPublisher(hit({ source: 'entity', label: null, domain: 'exchange.example' })))
      .toEqual({ name: null, domain: 'exchange.example', listed: true });
    // The lookup's merchant domain can be a different proven domain of the same account
    // than the one listing this address, so "listed on" would be a claim it can't back.
    expect(publicPublisher(hit({ source: 'merchant', label: 'Acme', domain: 'acme.com' })))
      .toEqual(via('acme.com', 'Acme'));
    expect(publicPublisher(hit({ source: null, label: null, domain: 'acme.com' }))?.listed).toBe(false);
    expect(publicPublisher(hit({ source: undefined, label: null, domain: 'acme.com' }))?.listed).toBe(false);
  });

  it('Verified with no domain shows no publisher line', () => {
    expect(publicPublisher(hit({ label: 'Acme', domain: null }))).toBeNull();
    expect(publicPublisher(hit({ label: 'Acme', domain: '   ' }))).toBeNull();
  });

  it('no hit, or no level, renders no Verify card', () => {
    expect(publicVerifyCard(null, 'clean')).toBeNull();
    expect(publicVerifyCard(hit({ level: null, label: 'Acme', domain: 'acme.com' }), 'clean')).toBeNull();
  });
});

describe('a green Verified never sits next to a flagged safety verdict', () => {
  it('flagged means danger or caution', () => {
    expect(safetyFlagged('danger')).toBe(true);
    expect(safetyFlagged('caution')).toBe(true);
    for (const v of ['clean', 'unclear', 'error', 'checking', 'idle', null, undefined]) {
      expect(safetyFlagged(v)).toBe(false);
    }
  });

  it.each([
    ['verified', 'clean', 'positive', false],
    ['verified', 'unclear', 'positive', false],
    ['verified', 'error', 'positive', false],
    ['verified', 'caution', 'neutral', true],
    ['verified', 'danger', 'neutral', true],
    ['claimed', 'clean', 'caution', false],
    ['claimed', 'unclear', 'caution', false],
    ['claimed', 'caution', 'neutral', true],
    ['claimed', 'danger', 'neutral', true],
  ] as const)('%s + safety %s → tone %s, warning leads: %s', (level, safety, tone, afterSafety) => {
    const card = publicVerifyCard(hit({ level, label: 'Acme', domain: 'acme.com' }), safety);
    expect(card?.tone).toBe(tone);
    expect(card?.afterSafety).toBe(afterSafety);
  });

  it('a flagged Verified still states the verified fact (it warns, it does not hide)', () => {
    const card = publicVerifyCard(hit({ label: 'Acme', domain: 'acme.com' }), 'danger');
    expect(card?.level).toBe('verified');
    expect(card?.publisher).toEqual(via('acme.com', 'Acme'));
  });

  it('community reports make a non-danger address verdict a caution', () => {
    expect(addressSafetyVerdict('clean', 2)).toBe('caution');
    expect(addressSafetyVerdict('clean', 0)).toBe('clean');
    expect(addressSafetyVerdict('clean', null)).toBe('clean');
    expect(addressSafetyVerdict('clean', undefined)).toBe('clean');
    expect(addressSafetyVerdict('caution', 1)).toBe('caution');
    expect(addressSafetyVerdict('danger', 3)).toBe('danger');
    const card = publicVerifyCard(hit({ label: 'Acme', domain: 'acme.com' }), addressSafetyVerdict('clean', 1));
    expect(card?.tone).toBe('neutral');
    expect(card?.afterSafety).toBe(true);
  });
});

describe('a shown business name is plain text and never a host platform\'s name', () => {
  it.each([
    ['Cyrillic/Armenian lookalike letters', 'C\u043e\u0456\u0578b\u0430\u0455e', 'cb.lol'],
    ['emoji and check marks', 'Acme \u2705\u2705', 'acme.com'],
    ['a right-to-left override', 'Acme\u202e', 'acme.com'],
    ['a zero-width space', 'Ac\u200bme', 'acme.com'],
    ['non-Latin words after the brand', 'Starbucks \u2705 \u041e\u0444\u0438\u0446\u0438\u0430\u043b\u044c\u043d\u044b\u0439', 'starbucks.xyz'],
  ])('%s: domain only', (_case, label, domain) => {
    expect(displayableName(label, domain)).toBeNull();
    expect(publicPublisher(hit({ label, domain }))).toEqual(via(domain));
  });

  it.each([
    ['GitHub', 'evil.github.io'],
    ['Vercel', 'shop.vercel.app'],
    ['Shopify', 'x.myshopify.com'],
    ['Pages', 'x.pages.dev'],
  ])('%s on %s (a shared host): domain only', (label, domain) => {
    expect(onSharedHost(domain)).toBe(true);
    expect(displayableName(label, domain)).toBeNull();
  });

  it('ordinary names still show, and a domain that only resembles a shared host is not one', () => {
    expect(displayableName("Joe's Coffee", 'joescoffee.com')).toBe("Joe's Coffee");
    expect(displayableName('A-C-M-E', 'acme.com')).toBe('A-C-M-E');
    expect(displayableName('Shop', 'shop.co.uk')).toBe('Shop');
    expect(onSharedHost('notgithub.io')).toBe(false);
    expect(onSharedHost('github.io.example.com')).toBe(false);
    expect(displayableName('x'.repeat(81), 'x'.repeat(81) + '.com')).toBeNull(); // too long
  });
});

describe('templates', () => {
  it('fills slots literally, even with $ patterns in a value', () => {
    expect(fillTemplate('Listed by {name} on {domain}', { name: 'Acme$&$1', domain: 'acme.com' }))
      .toBe('Listed by Acme$&$1 on acme.com');
    expect(fillTemplate('Hi {missing}', {})).toBe('Hi {missing}');
  });

  it('publisherText uses the right template per case', () => {
    const c = wcEn.checker;
    const t = { listedBy: c.verifiedListedBy, listedOn: c.verifiedListedOn, viaBy: c.verifiedViaBy, viaOn: c.verifiedViaOn };
    expect(publisherText({ name: 'Acme', domain: 'acme.com', listed: true }, t)).toBe('Listed by Acme on acme.com');
    expect(publisherText({ name: null, domain: 'acme.com', listed: true }, t)).toBe('Listed on acme.com');
    expect(publisherText({ name: 'Acme', domain: 'acme.com', listed: false }, t)).toBe('Acme, verified via acme.com');
    expect(publisherText({ name: null, domain: 'acme.com', listed: false }, t)).toBe('Verified via acme.com');
    expect(publisherText(null, t)).toBeNull();
  });

  it('splitTip finds the [[term]]', () => {
    expect(splitTip('a [[b c]] d')).toEqual({ before: 'a ', term: 'b c', after: ' d' });
    expect(splitTip('no marker')).toBeNull();
  });
});

describe('copy guards (en/es/fr)', () => {
  const NOUNS: ScanNoun[] = ['address', 'link', 'code'];
  const MEMBER = /verified almstins member|miembro verificado|membre vérifié/i;
  // Verify warns and flags; it never tells a payer a payment is blocked or stopped.
  const CONTROL = /do not pay|don['’]t pay|no pagues|ne payez pas|\bblock|\bstop\b|bloque|arrête|arrêt|detiene/i;
  // A Claimed result can be a stale domain listing that never proved control, so its copy
  // must not say control was proven.
  const CONTROL_PROVEN = /proved (it )?control|proved it controls|control confirmed|demostró (el control|que controla)|control confirmado|prouvé (le contrôle|qu’il contrôle)|contrôle confirmé/i;
  const SKIPPED = /skip this step|omiten este paso|sautent cette étape/i;

  it.each([['en', wcEn], ['es', wcEs], ['fr', wcFr]] as const)('wallet-checker %s', (_lang, loc) => {
    const c = loc.checker;
    expect(c.verifiedListedBy).toContain('{name}');
    expect(c.verifiedListedBy).toContain('{domain}');
    expect(c.verifiedListedOn).toContain('{domain}');
    expect(c.verifiedListedOn).not.toContain('{name}');
    expect(c.verifiedViaBy).toContain('{name}');
    expect(c.verifiedViaBy).toContain('{domain}');
    expect(c.verifiedViaOn).toContain('{domain}');
    expect(c.verifiedViaOn).not.toContain('{name}');
    expect(c.verifiedViaBody).toContain('{domain}');
    for (const v of [c.verifiedViaBy, c.verifiedViaOn, c.verifiedViaBody]) {
      expect(v).not.toMatch(/listed (by|on) \{domain\}|publicada (por|en) \{domain\}|publiée (par|sur) \{domain\}/i);
    }
    for (const v of [c.claimedTitle, c.claimedBody, c.claimedSub]) {
      expect(v).not.toMatch(CONTROL_PROVEN);
    }
    // The tip explains a domain proof (true as worded); it must not say every Claimed row
    // skipped it: a stale listing did not.
    expect(c.accountableDomainTip).not.toMatch(SKIPPED);
    expect(c.claimedBody).not.toMatch(/\{name\}|\{label\}|\{domain\}/);
    expect(splitTip(c.claimedBody)).not.toBeNull();
    expect(c.chains.tron).toBeTruthy();
    for (const v of [c.verifiedTitle, c.verifiedBody, c.verifiedSub, c.claimedTitle, c.claimedBody, c.claimedSub, c.verifyFlaggedNote]) {
      expect(v).not.toMatch(MEMBER);
      expect(v).not.toMatch(CONTROL);
    }
    expect(c).not.toHaveProperty('verifiedMerchant');
    expect(c).not.toHaveProperty('verifiedVia');
  });

  it.each(['en', 'es', 'fr'] as const)('scan %s', (lang) => {
    const t = verifyScanCopy[lang];
    expect(Object.keys(t).sort()).toEqual(Object.keys(verifyScanCopy.en).sort());
    for (const n of NOUNS) {
      expect(t.listedBy[n]).toContain('{name}');
      expect(t.listedBy[n]).toContain('{domain}');
      expect(t.listedOn[n]).toContain('{domain}');
      expect(t.listedOn[n]).not.toContain('{name}');
      expect(t.viaBy[n]).toContain('{name}');
      expect(t.viaBy[n]).toContain('{domain}');
      expect(t.viaOn[n]).toContain('{domain}');
      expect(t.viaOn[n]).not.toContain('{name}');
      expect(t.claimedBody[n]).not.toMatch(CONTROL_PROVEN);
      expect(t.claimedTitle[n]).not.toMatch(CONTROL_PROVEN);
      expect(t.claimedBody[n]).not.toMatch(/\{name\}|\{label\}|\{domain\}/);
      expect(splitTip(t.claimedBody[n])).not.toBeNull();
      for (const v of [t.claimedBody[n], t.flaggedNote[n], t.safetyDanger[n], t.safetyCaution[n], t.safetyUnclear[n], t.notVerifiedBody[n]]) {
        expect(v).not.toMatch(MEMBER);
        expect(v).not.toMatch(CONTROL);
      }
    }
    expect(t.accountableDomainTip).not.toMatch(SKIPPED);
  });

  it.each([['en', dashEn], ['es', dashEs], ['fr', dashFr]] as const)('dashboard %s: no "with your label" promise', (_lang, loc) => {
    const steps = [...loc.howToStripeSteps, ...loc.howToCustomerSteps];
    for (const v of steps) {
      expect(v).not.toMatch(/with your label|con tu etiqueta|avec votre libellé/i);
      expect(v).not.toMatch(CONTROL);
    }
    expect(loc.notice).not.toMatch(/held privately|de forma privada|restent privées/i);
  });
});
