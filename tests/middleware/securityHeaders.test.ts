import { describe, it, expect } from 'vitest';
import { applySecurityHeaders, needsPublicHeaders, withPublicHeaders } from '../../src/middleware/securityHeaders';

describe('applySecurityHeaders (moved from app.ts)', () => {
  it('sets the same headers as before, except camera/geolocation now allowed for this origin', () => {
    const r = applySecurityHeaders(new Response('ok', { status: 201, headers: { 'X-Keep': '1' } }));
    expect(r.status).toBe(201);
    expect(r.headers.get('X-Keep')).toBe('1');
    expect(r.headers.get('X-Frame-Options')).toBe('DENY');
    expect(r.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(r.headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
    expect(r.headers.get('Cross-Origin-Opener-Policy')).toBe('same-origin');
    expect(r.headers.get('Cross-Origin-Resource-Policy')).toBe('same-origin');
    expect(r.headers.get('Permissions-Policy')).toBe(
      'camera=(self), microphone=(), geolocation=(self), payment=(), usb=(), interest-cohort=()',
    );
    expect(r.headers.get('Content-Security-Policy-Report-Only')).toContain("frame-ancestors 'none'");
  });

  it('works on an immutable redirect response', () => {
    const r = applySecurityHeaders(Response.redirect('https://almstins.com/login', 303));
    expect(r.status).toBe(303);
    expect(r.headers.get('X-Frame-Options')).toBe('DENY');
  });
});

describe('public pages that get the headers', () => {
  it('covers the financing pages, their aliases, the landing, and the two Verify sign-in pages', () => {
    for (const p of [
      '/receivables', '/receivables/', '/receivables/desk', '/receivables/milestone-check',
      '/verify/desk', '/verify/attest', '/verify/offer/', '/verify/cairn', '/verify/cairn-attest',
      '/verify/login', '/verify/agent-keys',
    ]) expect(needsPublicHeaders(p), p).toBe(true);
    for (const p of ['/verify', '/verify/scan', '/verify/es', '/verify/agents', '/verify-record', '/', '/artifacts/proof']) {
      expect(needsPublicHeaders(p), p).toBe(false);
    }
  });

  it('financing pages are never indexed and never leak their URL to other sites; the landing stays indexable', () => {
    const fin = withPublicHeaders(new Response('x'), '/receivables/attest');
    expect(fin.headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
    expect(fin.headers.get('Referrer-Policy')).toBe('same-origin');
    expect(fin.headers.get('X-Frame-Options')).toBe('DENY');

    const old = withPublicHeaders(new Response('x'), '/verify/countersign');
    expect(old.headers.get('X-Robots-Tag')).toBe('noindex, nofollow');

    const landing = withPublicHeaders(new Response('x'), '/receivables');
    expect(landing.headers.get('X-Robots-Tag')).toBeNull();
    expect(landing.headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');

    // The inspector's geotag on the milestone attestation page needs geolocation for this origin.
    for (const p of ['/verify/cairn-attest', '/receivables/milestone-check']) {
      expect(withPublicHeaders(new Response('x'), p).headers.get('Permissions-Policy'), p).toContain('geolocation=(self)');
    }

    const login = withPublicHeaders(new Response('x'), '/verify/login');
    expect(login.headers.get('X-Robots-Tag')).toBeNull();
    expect(login.headers.get('X-Frame-Options')).toBe('DENY');
  });
});
