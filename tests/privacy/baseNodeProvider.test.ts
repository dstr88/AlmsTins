import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import * as policy from '../../src/i18n/privacyPolicy';

/**
 * The Agent Vault reads Base through a Coinbase Developer Platform node (BASE_RPC_URL,
 * src/lib/agentVault/baseRpc.ts), which receives the agent wallet addresses being read. The
 * policy's "Blockchain data" list names it in every language, in the same item as the other
 * chain-data providers (which receive addresses, never account details).
 */
const ROOT = path.resolve(__dirname, '../..');
const bodies = { en: policy.en.body, es: policy.es.body, fr: policy.fr.body };
const itemOf = (body: string, label: RegExp) => body.split('<li>').find((li) => label.test(li)) ?? '';

describe('privacy policy: the Base node is a named blockchain data provider', () => {
  it('the vault really reads Base through BASE_RPC_URL', () => {
    expect(readFileSync(path.join(ROOT, 'src/lib/agentVault/baseRpc.ts'), 'utf8')).toContain('BASE_RPC_URL');
  });
  it.each([
    ['en', /<strong>Blockchain data:<\/strong>/, '(Base, for the Agent Vault)'],
    ['es', /<strong>Datos de blockchain:<\/strong>/, '(Base, para el Agent Vault)'],
    ['fr', /<strong>Données blockchain :<\/strong>/, "(Base, pour l'Agent Vault)"],
  ] as const)('%s names Coinbase Developer Platform for Base in the blockchain data item', (lang, label, note) => {
    const item = itemOf(bodies[lang], label);
    expect(item).not.toBe('');
    expect(item).toContain(`<strong>Coinbase Developer Platform</strong> ${note}`);
  });
});
