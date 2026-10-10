import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * We do not store names (privacy policy v1.2, 2026-10-10). Sign-in used to save one two
 * ways: the signIn callback backfilled auth_users.name from the Google or GitHub profile,
 * and linkAccount saved Google's id_token, which carries the person's name, photo and
 * email, with the access and refresh tokens. src/scripts/clearStoredSignInNames.mjs clears
 * what was saved before.
 */

const calls: Array<{ sql: string; args: unknown[] }> = [];
vi.mock('../../src/lib/db', () => ({
  db: {
    execute: async (q: { sql: string; args?: unknown[] }) => {
      calls.push({ sql: q.sql, args: q.args ?? [] });
      return { rows: [], rowsAffected: 1 };
    },
    batch: async () => [],
  },
}));
vi.mock('../../src/lib/authTokenTables', () => ({ ensureTokenTable: async () => {} }));

import { authAdapter } from '../../src/lib/authAdapter';

beforeEach(() => { calls.length = 0; });

describe('linkAccount keeps the provider link, not what the provider sends', () => {
  it('stores no id_token, access_token or refresh_token', async () => {
    await authAdapter().linkAccount!({
      userId: 'u1', type: 'oidc', provider: 'google', providerAccountId: 'g-123',
      access_token: 'ya29.secret', refresh_token: '1//refresh', id_token: 'eyJ.name-inside.sig',
      token_type: 'bearer', scope: 'openid email profile', expires_at: 1, session_state: null,
    } as never);
    const insert = calls.find((c) => /INSERT INTO auth_accounts/.test(c.sql))!;
    expect(insert).toBeDefined();
    const flat = JSON.stringify(insert.args);
    expect(flat).not.toContain('ya29.secret');
    expect(flat).not.toContain('1//refresh');
    expect(flat).not.toContain('name-inside');
    expect(insert.args).toContain('google');
    expect(insert.args).toContain('g-123');
  });
});

describe('createUser stores no name or photo', () => {
  it('writes null for both', async () => {
    const u = await authAdapter().createUser!({ id: 'u2', email: 'a@example.com', emailVerified: null, name: 'Jane Doe', image: 'https://x/p.png' } as never);
    expect(u.name).toBeNull();
    expect(JSON.stringify(calls.map((c) => c.args))).not.toContain('Jane Doe');
  });
});

describe('the sign-in route never writes a name', () => {
  const src = readFileSync(path.resolve(__dirname, '../../src/pages/api/auth/[...auth].ts'), 'utf8');
  it('has no name backfill from the provider profile', () => {
    expect(src).not.toMatch(/profile\?\.name/);
    expect(src).not.toMatch(/name\s*=\s*CASE/);
  });
  it('stores no provider tokens when it links an account itself', () => {
    expect(src).not.toMatch(/account\.(access_token|refresh_token|id_token)\s*\?\?/);
  });
});
