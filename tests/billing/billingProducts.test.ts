import { describe, it, expect } from 'vitest';
import {
  ALMSTINS_PRODUCT,
  almstinsPlanForPrice,
  almstinsPlanForSubscription,
  isTaggedForAnotherProduct,
} from '../../src/lib/billingProducts';

/**
 * Every paid product is sold from one Stripe account, so the tracker's billing code has to tell
 * its own prices and subscriptions from the others'. These pin the pure helper both the checkout
 * and the webhook use (src/lib/billingProducts.ts): what counts as an Almstins price, what
 * counts as another product's tag, and that the two together decide a subscription.
 *
 * Pure functions: no mocks, no database, no network.
 */

// The map is built from STRIPE_PRICE_* env vars (src/lib/stripe.ts). One that was unset when the
// app was built becomes the key "undefined", one set to nothing becomes "", exactly as here.
const unset = undefined as unknown as string;
const PRICES: Record<string, string> = {
  price_test_starter: 'starter',
  price_test_pro: 'pro',
  price_test_pro_year: 'pro',
  [unset]: 'unlimited',
  '': 'starter',
  null: 'starter',
};

describe('almstinsPlanForPrice', () => {
  it('maps each configured Almstins price to its plan', () => {
    expect(almstinsPlanForPrice('price_test_starter', PRICES)).toBe('starter');
    expect(almstinsPlanForPrice('price_test_pro', PRICES)).toBe('pro');
    expect(almstinsPlanForPrice('price_test_pro_year', PRICES)).toBe('pro');
  });

  it('knows the test map really has the degenerate keys an unset env var leaves', () => {
    expect(Object.keys(PRICES)).toEqual(expect.arrayContaining(['undefined', '', 'null']));
  });

  it('returns null for a price that is not in the map', () => {
    expect(almstinsPlanForPrice('price_test_other', PRICES)).toBeNull();
    expect(almstinsPlanForPrice('PRICE_TEST_PRO', PRICES)).toBeNull();
    expect(almstinsPlanForPrice(' price_test_pro', PRICES)).toBeNull();
  });

  it.each([
    'constructor',
    '__proto__',
    'toString',
    'valueOf',
    'hasOwnProperty',
    'isPrototypeOf',
    'propertyIsEnumerable',
    'toLocaleString',
    '__defineGetter__',
    '__lookupGetter__',
  ])('returns null for the inherited object key %s', (key) => {
    expect(almstinsPlanForPrice(key, PRICES)).toBeNull();
    // The plain lookup the old code did finds something, which is the bug.
    expect(PRICES[key]).toBeTruthy();
  });

  it('returns null for the key "undefined" an unset env var leaves, and for ""', () => {
    expect(almstinsPlanForPrice('undefined', PRICES)).toBeNull();
    expect(almstinsPlanForPrice('', PRICES)).toBeNull();
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['a number', 42],
    ['an object', {}],
    ['an array that prints as a price', ['price_test_pro']],
    ['an object that prints as a price', { toString: () => 'price_test_pro' }],
    ['a boolean', true],
  ])('returns null for %s, which is not a string', (_label, input) => {
    expect(almstinsPlanForPrice(input, PRICES)).toBeNull();
  });

  it('returns null for every input when the map is empty', () => {
    expect(almstinsPlanForPrice('price_test_pro', {})).toBeNull();
  });
});

describe('isTaggedForAnotherProduct', () => {
  it.each([
    ['no metadata at all', undefined],
    ['null metadata', null],
    ['metadata with no tag, as on a subscription from before checkout tagged', { tenant_id: 'tenant-a' }],
    ['the Almstins tag', { tenant_id: 'tenant-a', product: ALMSTINS_PRODUCT }],
    ['a tag Stripe left undefined', { product: undefined }],
    ['a tag Stripe left null', { product: null }],
  ])('is false for %s', (_label, metadata) => {
    expect(isTaggedForAnotherProduct(metadata)).toBe(false);
  });

  it.each([
    ['another product', 'agentics'],
    ['a different case', 'Almstins'],
    ['the Almstins tag with a space', 'almstins '],
    ['an empty tag', ''],
    ['a number', 5],
    ['an object', { name: 'almstins' }],
  ])('is true for %s', (_label, product) => {
    expect(isTaggedForAnotherProduct({ tenant_id: 'tenant-a', product })).toBe(true);
  });

  it('the tag value is "almstins": subscriptions already carry it, so it never changes', () => {
    expect(ALMSTINS_PRODUCT).toBe('almstins');
  });
});

describe('almstinsPlanForSubscription', () => {
  it('gives the plan for a known price with no tag (a subscription from before checkout tagged)', () => {
    expect(almstinsPlanForSubscription('price_test_pro', [{ tenant_id: 'tenant-a' }], PRICES)).toBe('pro');
    expect(almstinsPlanForSubscription('price_test_pro', [], PRICES)).toBe('pro');
    expect(almstinsPlanForSubscription('price_test_pro', [undefined, null], PRICES)).toBe('pro');
  });

  it('gives the plan for a known price tagged Almstins, wherever the tag sits', () => {
    const tagged = { product: ALMSTINS_PRODUCT };
    expect(almstinsPlanForSubscription('price_test_starter', [tagged], PRICES)).toBe('starter');
    expect(almstinsPlanForSubscription('price_test_starter', [tagged, tagged], PRICES)).toBe('starter');
    expect(almstinsPlanForSubscription('price_test_starter', [tagged, {}], PRICES)).toBe('starter');
  });

  it('gives null for a known price when any metadata tags another product', () => {
    const other = { product: 'agentics' };
    expect(almstinsPlanForSubscription('price_test_pro', [other], PRICES)).toBeNull();
    expect(almstinsPlanForSubscription('price_test_pro', [other, {}], PRICES)).toBeNull();
    expect(almstinsPlanForSubscription('price_test_pro', [{}, other], PRICES)).toBeNull();
    expect(almstinsPlanForSubscription('price_test_pro', [{ product: ALMSTINS_PRODUCT }, other], PRICES)).toBeNull();
  });

  it('gives null for a price that is not an Almstins plan, tagged or not', () => {
    expect(almstinsPlanForSubscription('price_test_other', [], PRICES)).toBeNull();
    expect(almstinsPlanForSubscription('price_test_other', [{}], PRICES)).toBeNull();
    // A tag cannot vouch for a price the map does not know.
    expect(almstinsPlanForSubscription('price_test_other', [{ product: ALMSTINS_PRODUCT }], PRICES)).toBeNull();
  });

  it.each(['constructor', '__proto__', 'toString', 'undefined', ''])('gives null for the price %j', (price) => {
    expect(almstinsPlanForSubscription(price, [], PRICES)).toBeNull();
    expect(almstinsPlanForSubscription(price, [{ product: ALMSTINS_PRODUCT }], PRICES)).toBeNull();
  });

  it('gives null for a subscription with no price at all', () => {
    expect(almstinsPlanForSubscription(undefined, [], PRICES)).toBeNull();
    expect(almstinsPlanForSubscription(undefined, [{ product: ALMSTINS_PRODUCT }], PRICES)).toBeNull();
  });
});
