import { describe, it, expect } from 'vitest';
import { verifyLoginMode } from '../../src/lib/verifyLoginMode';

/**
 * /verify/login serves Almstins Verify and the financing desks from one page. The
 * `next` path picks the heading: Verify for the merchant dashboard and agent keys,
 * financier for the desks, client for everything else (including no `next` at all).
 */
describe('verify login — mode from next', () => {
  it('serves Verify for the merchant dashboard and agent keys', () => {
    expect(verifyLoginMode('/dashboard/verify')).toBe('verify');
    expect(verifyLoginMode('/dashboard/verify?tab=domains')).toBe('verify');
    expect(verifyLoginMode('/dashboard/verify/anything')).toBe('verify');
    expect(verifyLoginMode('/verify/agent-keys')).toBe('verify');
  });

  it('serves the financier heading for the desks', () => {
    expect(verifyLoginMode('/verify/desk')).toBe('financier');
    expect(verifyLoginMode('/verify/desk?id=INV-4471')).toBe('financier');
    expect(verifyLoginMode('/verify/cairn')).toBe('project');
    expect(verifyLoginMode('/receivables/desk')).toBe('financier');
    expect(verifyLoginMode('/receivables/desk?id=INV-1')).toBe('financier');
    expect(verifyLoginMode('/receivables/milestones')).toBe('project');
  });

  it('serves the role-neutral Receivables sign-in for the /receivables landing', () => {
    expect(verifyLoginMode('/receivables')).toBe('receivables');
    expect(verifyLoginMode('/receivables/')).toBe('receivables');
    expect(verifyLoginMode('/receivables/client')).toBe('client');
  });

  it('keeps the client heading for everything else, including no next', () => {
    expect(verifyLoginMode(null)).toBe('client');
    expect(verifyLoginMode(undefined)).toBe('client');
    expect(verifyLoginMode('')).toBe('client');
    expect(verifyLoginMode('/verify/client')).toBe('client');
    expect(verifyLoginMode('/verify/confirm')).toBe('client');
    expect(verifyLoginMode('/verify/invite?token=abc')).toBe('client');
  });

  it('matches whole path segments only, never a prefix or a query string', () => {
    expect(verifyLoginMode('/dashboard/verifyx')).toBe('client');
    expect(verifyLoginMode('/verify/desktop')).toBe('client');
    expect(verifyLoginMode('/verify/invite?token=/verify/desk')).toBe('client');
    expect(verifyLoginMode('/verify/client#/dashboard/verify')).toBe('client');
    expect(verifyLoginMode('https://evil.example/dashboard/verify')).toBe('client');
  });
});
