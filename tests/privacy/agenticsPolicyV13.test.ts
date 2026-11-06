import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import * as policy from '../../src/i18n/privacyPolicy';
import * as terms from '../../src/i18n/termsOfService';
import { FREE_ADDRESSES, FREE_BOTS } from '../../src/i18n/agentics';
import { VAULT_CHAINS } from '../../src/lib/agentVault/addresses';

/**
 * Privacy Policy v1.3 and User Agreement v1.3 add Almstins Agentics (the Agent Vault): what it keeps,
 * what it reads, what it does not, and the Free plan's numbers. This file holds the two documents to the
 * code they describe, in all three languages, so neither can drift from what is built:
 *
 *   - the version and effective date are the same everywhere (v1.4, November 6, 2026; v1.3 shipped the day before: a later
 *     version changes VERSION and EFFECTIVE below and the six body headers together, and this file fails if one is missed);
 *   - the policy discloses each thing the Vault keeps and reads, and the one thing it never does (link an
 *     address to a person);
 *   - the Terms' Free plan numbers are the numbers in entitlements.ts, and the chains it names are the ones
 *     the Vault reads (addresses.ts);
 *   - Part B.9 keeps the product's wording rules: Almstins verifies, flags and records, never stops or
 *     blocks anything, and calls nothing safe.
 *
 * Pure copy checks: no database, no network.
 */

const LANGS = ['en', 'es', 'fr'] as const;
type Lang = (typeof LANGS)[number];

/** The version both documents carry, and the day it took effect, as each language writes it (v1.4, Nov 6, 2026: the unmatched-payment email). */
const VERSION = '1.4';
const EFFECTIVE: Record<Lang, string> = { en: 'November 6, 2026', es: '6 de noviembre de 2026', fr: '6 novembre 2026' };

const policyBodies: Record<Lang, string> = { en: policy.en.body, es: policy.es.body, fr: policy.fr.body };
const termsBodies: Record<Lang, string> = { en: terms.en.body, es: terms.es.body, fr: terms.fr.body };

const source = (rel: string) => readFileSync(path.resolve(__dirname, '../..', rel), 'utf8');

/** One numbered section of the policy, from its <h2> to the next. */
function section(body: string, n: number): string {
  const start = body.indexOf(`<h2>${n}.`);
  expect(start, `policy section ${n}`).toBeGreaterThan(-1);
  const next = body.indexOf('<h2>', start + 4);
  return body.slice(start, next === -1 ? undefined : next);
}

/** Part B.9 of the Agreement: it is the last Part, so it runs to the end of the body. */
function partB9(body: string): string {
  const start = body.indexOf('<h2>B.9 ');
  expect(start, 'B.9 found').toBeGreaterThan(-1);
  return body.slice(start);
}

function clause(b9: string, n: number): string {
  const start = b9.indexOf(`<strong>B.9.${n} `);
  expect(start, `B.9.${n} found`).toBeGreaterThan(-1);
  const next = b9.indexOf(`<strong>B.9.${n + 1} `, start);
  return b9.slice(start, next === -1 ? undefined : next);
}

/** The Free plan, read from the file that enforces it. */
const entitlements = source('src/lib/agentVault/entitlements.ts');
const limits = /FREE_LIMITS: PlanLimits = \{ bots: (\d+), addresses: (\d+), walletsPerBot: (\d+) \}/.exec(entitlements);
const perDayMatch = /FREE_LOGGED_CHECKS_PER_DAY = ([\d_]+);/.exec(entitlements);
const FREE = {
  bots: Number(limits?.[1]),
  addresses: Number(limits?.[2]),
  walletsPerBot: Number(limits?.[3]),
  checksPerDay: Number((perDayMatch?.[1] ?? '').replace(/_/g, '')),
};

describe('the Free plan numbers in the Terms are the ones the code enforces', () => {
  it('reads the plan out of entitlements.ts', () => {
    expect(FREE).toEqual({ bots: 3, addresses: 15, walletsPerBot: 5, checksPerDay: 5000 });
    expect(FREE_BOTS).toBe(FREE.bots);
    expect(FREE_ADDRESSES).toBe(FREE.addresses);
  });

  const b911: Record<Lang, RegExp> = {
    en: new RegExp(`up to ${FREE.bots} Agents, ${FREE.addresses} Registered Addresses shared across them, and ${FREE.walletsPerBot} wallets per Agent, and records up to 5,000 checks per Agent per UTC day`),
    es: new RegExp(`hasta ${FREE.bots} Agentes, ${FREE.addresses} Direcciones Registradas compartidas entre ellos y ${FREE.walletsPerBot} wallets por Agente, y registra hasta 5000 verificaciones por Agente por día UTC`),
    fr: new RegExp(`jusqu'à ${FREE.bots} Agents, ${FREE.addresses} Adresses Enregistrées partagées entre eux et ${FREE.walletsPerBot} wallets par Agent, et enregistre jusqu'à 5&nbsp;000 vérifications par Agent et par jour UTC`),
  };
  it.each(LANGS)('%s: B.9.11 states the plan exactly', (lang) => {
    expect(clause(partB9(termsBodies[lang]), 11)).toMatch(b911[lang]);
  });
});

describe('the Terms name the chains the Vault reads, and no others', () => {
  it.each(LANGS)('%s: B.9.7 lists every Vault chain and no chain the Vault does not read', (lang) => {
    const b97 = clause(partB9(termsBodies[lang]), 7).toLowerCase();
    for (const chain of VAULT_CHAINS) expect(b97, chain).toContain(chain);
    for (const other of ['bitcoin', 'litecoin', 'solana', 'sui', 'rootstock']) expect(b97, other).not.toContain(other);
  });
});

describe('both documents carry the same version and effective date', () => {
  const header = /<p><strong>[^<]+<\/strong> (.+?) &nbsp;(?:&middot;|·)&nbsp; <strong>[^<]+<\/strong> (\d+\.\d+)<br\/>/;
  it.each(LANGS)('%s: Privacy Policy and User Agreement are the same version on the same day', (lang) => {
    const p = header.exec(policyBodies[lang]);
    const t = header.exec(termsBodies[lang]);
    expect(p?.[2], 'policy version').toBe(VERSION);
    expect(t?.[2], 'terms version').toBe(VERSION);
    expect(p?.[1], 'policy date').toBe(EFFECTIVE[lang]);
    expect(t?.[1], 'terms date').toBe(EFFECTIVE[lang]);
  });

  it('has no unfinished marker in either document', () => {
    for (const body of [...Object.values(policyBodies), ...Object.values(termsBodies)]) {
      // Case-sensitive and whole-word for the shouted markers: "todo" and "TODOS" are Spanish words.
      expect(body).not.toMatch(/\b(TODO|FIXME|XXX)\b/);
      expect(body).not.toMatch(/\[(date|fecha|effective|à compléter)[^\]]*\]/i);
    }
  });
});

describe('Privacy Policy v1.3 discloses what the Agent Vault keeps and reads', () => {
  const P: Record<Lang, Record<string, RegExp>> = {
    en: {
      vault31: /Almstins Agentics \(if you use the Agent Vault\)/,
      keyHash: /a one-way hash of the key \(the key itself is shown to you once and is not kept\)/,
      ipHash: /salted one-way hash of the caller's IP address \(never the IP address itself\)/,
      runVault: /Run the Agent Vault for you/,
      ownWallet: /<strong>own wallet<\/strong>/,
      readCadence: /To find those transfers, once a day, about once a minute while your Live page is open \(one agent at a time, in turn, up to a daily limit\), or when you press a button, we read the block explorer's listing/,
      etherscan: /Etherscan for Ethereum and Polygon/,
      routescan: /Routescan\/Snowtrace for Avalanche/,
      appendOnly: /<strong>dated, append-only record<\/strong>/,
      noPerson: /<strong>never<\/strong> link an address to a person, and we do not monitor third parties/,
      onlyRegistered: /We read only the wallets you register, never the history of any other address\./,
      everyTransfer: /every direct transfer we read of the agent's own wallet, in either direction \(its transaction hash, the address on the other side,/,
      counterparty: /trusted, pending, or flagged for a destination you registered, or not on the list/,
      unmatched: /with no check asked about it in the hour before, is marked as unmatched/,
      sameClass: /the same kind the Service keeps for any wallet you add \(the first point of this Section\)/,
      noDestinationHistory: /We do not read a destination's own history/,
      emailsCarryCounts: /those emails carry counts or the name of the answer, and never an address, a label, or an amount/,
      alertsAlways: /to email you at once whenever a check your agent asks is answered anything other than proven, at most one email an hour for the same address \(for an answer of established, only if you turn that email on\)/,
      unlistedChecks: /including checks about addresses that are not on the agent's list, which records that your agent asked and does not put the address under watch/,
      retention: /The Agent Vault's record is append-only while your account is open/,
      mail: /welcome, report, alert, and account emails/,
      dailyLimit: /Past the plan's daily limit, a check is answered and not recorded, except one that comes back flagged, and the check that finds the limit used up carries a mark/,
      dailyLimitShort: /On a plan with a daily limit, a check past the limit is answered and not recorded, except one that comes back flagged\./,
    },
    es: {
      vault31: /Almstins Agentics \(si usa el Agent Vault\)/,
      keyHash: /un hash unidireccional de la clave \(la clave en sí se le muestra una sola vez y no se conserva\)/,
      ipHash: /hash unidireccional con sal de la dirección IP de quien llama \(nunca la dirección IP en sí\)/,
      runVault: /Operar el Agent Vault por usted/,
      ownWallet: /<strong>wallet propia<\/strong>/,
      readCadence: /Para encontrar esas transferencias, una vez al día, aproximadamente una vez por minuto mientras su página Live está abierta \(un agente a la vez, por turnos, hasta un límite diario\), o cuando usted pulsa un botón, leemos/,
      etherscan: /Etherscan para Ethereum y Polygon/,
      routescan: /Routescan\/Snowtrace para Avalanche/,
      appendOnly: /<strong>registro fechado y de solo adición<\/strong>/,
      noPerson: /<strong>Nunca<\/strong> vinculamos una dirección con una persona y no supervisamos a terceros/,
      onlyRegistered: /Leemos únicamente las wallets que usted registra, nunca el historial de otra dirección\./,
      everyTransfer: /cada transferencia directa que leemos de la wallet propia del agente, en ambos sentidos \(su hash de transacción, la dirección del otro extremo,/,
      counterparty: /de confianza, pendiente o marcada para un destino que usted registró, o fuera de la lista/,
      unmatched: /sin ninguna verificación pedida sobre ella en la hora anterior, se marca como sin correspondencia/,
      sameClass: /la misma clase de datos que el Servicio conserva para cualquier wallet que usted agrega \(primer punto de esta Sección\)/,
      noDestinationHistory: /No leemos el historial propio de un destino/,
      emailsCarryCounts: /esos correos incluyen recuentos o el nombre de la respuesta, y nunca una dirección, una etiqueta ni un monto/,
      alertsAlways: /para escribirle de inmediato cada vez que una verificación que pide su agente recibe una respuesta distinta de proven, como máximo un correo por hora para la misma dirección \(para una respuesta established, solo si usted activa ese correo\)/,
      unlistedChecks: /incluidas las verificaciones sobre direcciones que no están en la lista del agente, lo cual registra que su agente preguntó y no pone la dirección bajo vigilancia/,
      retention: /El registro del Agent Vault es de solo adición mientras su cuenta esté abierta/,
      mail: /correos de bienvenida, de informe, de alerta y de cuenta/,
      dailyLimit: /Superado el límite diario del plan, una verificación se responde y no se registra, salvo una que resulte "flagged", y la verificación que encuentra el límite agotado lleva una marca/,
      dailyLimitShort: /En un plan con límite diario, una verificación posterior al límite se responde y no se registra, salvo una que resulte "flagged"\./,
    },
    fr: {
      vault31: /Almstins Agentics \(si vous utilisez l'Agent Vault\)/,
      keyHash: /une empreinte à sens unique de la clé \(la clé elle-même vous est montrée une seule fois et n'est pas conservée\)/,
      ipHash: /empreinte à sens unique salée de l'adresse IP de l'appelant \(jamais l'adresse IP elle-même\)/,
      runVault: /Faire fonctionner l'Agent Vault pour vous/,
      ownWallet: /<strong>wallet propre<\/strong>/,
      readCadence: /Pour trouver ces transferts, une fois par jour, environ une fois par minute pendant que votre page Live est ouverte \(un agent à la fois, à tour de rôle, dans la limite d'un plafond quotidien\), ou lorsque vous appuyez sur un bouton, nous lisons/,
      etherscan: /Etherscan pour Ethereum et Polygon/,
      routescan: /Routescan\/Snowtrace pour Avalanche/,
      appendOnly: /<strong>registre daté, en ajout seul<\/strong>/,
      noPerson: /Nous ne relions <strong>jamais<\/strong> une adresse à une personne et nous ne surveillons pas de tiers/,
      onlyRegistered: /Nous ne lisons que les wallets que vous enregistrez, jamais l'historique d'une autre adresse\./,
      everyTransfer: /chaque transfert direct que nous lisons du wallet propre de l'agent, dans les deux sens \(son hash de transaction, l'adresse de l'autre extrémité,/,
      counterparty: /de confiance, en attente ou signalée pour une destination que vous avez enregistrée, ou hors liste/,
      unmatched: /sans aucune vérification demandée à son sujet dans l'heure précédente, est marquée comme sans correspondance/,
      sameClass: /de la même nature que celles que le Service conserve pour tout wallet que vous ajoutez \(premier point de cette Section\)/,
      noDestinationHistory: /Nous ne lisons pas l'historique propre d'une destination/,
      emailsCarryCounts: /ces e-mails contiennent des totaux ou le nom de la réponse, et jamais une adresse, une étiquette ni un montant/,
      alertsAlways: /pour vous écrire aussitôt chaque fois qu'une vérification demandée par votre agent reçoit une réponse autre que proven, au plus un e-mail par heure pour la même adresse \(pour une réponse established, seulement si vous activez cet e-mail\)/,
      unlistedChecks: /y compris les vérifications portant sur des adresses qui ne figurent pas sur la liste de l'agent, ce qui enregistre que votre agent a posé la question et ne place pas l'adresse sous surveillance/,
      retention: /Le registre de l'Agent Vault est en ajout seul tant que votre compte est ouvert/,
      mail: /e-mails de bienvenue, de rapport, d'alerte et de compte/,
      dailyLimit: /Au-delà de la limite quotidienne du plan, une vérification reçoit sa réponse et n'est pas enregistrée, sauf une qui revient « flagged », et la vérification qui trouve la limite atteinte porte une marque/,
      dailyLimitShort: /Avec un plan à limite quotidienne, une vérification postérieure à la limite reçoit sa réponse et n'est pas enregistrée, sauf une qui revient « flagged »\./,
    },
  };

  it.each(LANGS)('%s: Section 3 lists the agents, wallets, destinations and key facts, and the hashed caller address', (lang) => {
    const s3 = section(policyBodies[lang], 3);
    expect(s3).toMatch(P[lang].vault31);
    expect(s3).toMatch(P[lang].keyHash);
    expect(s3).toMatch(P[lang].ipHash);
    expect(s3).toMatch(P[lang].dailyLimitShort);
  });

  it.each(LANGS)('%s: Section 4 says the Vault is run for the user', (lang) => {
    expect(section(policyBodies[lang], 4)).toMatch(P[lang].runVault);
  });

  it.each(LANGS)('%s: Section 5 says what is read, from where, and what is never done', (lang) => {
    const s5 = section(policyBodies[lang], 5);
    const p = P[lang];
    for (const k of ['ownWallet', 'etherscan', 'routescan', 'appendOnly', 'noPerson', 'onlyRegistered', 'noDestinationHistory', 'emailsCarryCounts', 'unlistedChecks', 'dailyLimit', 'readCadence', 'everyTransfer', 'counterparty', 'unmatched', 'sameClass', 'alertsAlways'] as const) {
      expect(s5, k).toMatch(p[k]);
    }
  });

  it.each(LANGS)('%s: Section 10 lists report emails and Section 11 says the record outlives a removal until the account is deleted', (lang) => {
    expect(section(policyBodies[lang], 10)).toMatch(P[lang].mail);
    expect(section(policyBodies[lang], 11)).toMatch(P[lang].retention);
  });

  it.each(LANGS)('%s: Section 5 no longer promises the narrow record of before slice 8 (only the transfers with a trusted destination)', (lang) => {
    const s5 = section(policyBodies[lang], 5);
    const narrow: Record<Lang, RegExp[]> = {
      en: [/keep only the transfers whose other side is one of your trusted destinations/, /between the agent's own wallet and a destination you trusted/],
      es: [/conservamos únicamente las transferencias cuyo otro extremo/, /entre la wallet propia del agente y un destino en el que usted confió/],
      fr: [/ne conservons que les transferts dont l'autre extrémité/, /entre le wallet propre de l'agent et une destination à laquelle vous avez accordé votre confiance/],
    };
    for (const re of narrow[lang]) expect(s5).not.toMatch(re);
  });

  it('does not describe a live feed, a watch on the receiving wallet, or a read of any chain the Vault does not read', () => {
    for (const lang of LANGS) {
      const s5 = section(policyBodies[lang], 5);
      const start = s5.indexOf(lang === 'en' ? 'Almstins Agentics &mdash;' : 'Almstins Agentics &mdash;');
      expect(start, lang).toBeGreaterThan(-1);
      const bullet = s5.slice(start, s5.indexOf('</li>', start)).toLowerCase();
      for (const other of ['bitcoin', 'litecoin', 'solana', 'real time', 'real-time', 'tiempo real', 'temps réel']) expect(bullet, `${lang} ${other}`).not.toContain(other);
    }
  });
});

describe('User Agreement v1.3, Part B.9, keeps the product\'s rules', () => {
  it.each(LANGS)('%s: defines Agentics in A.1 and has B.9.1 through B.9.14, in order', (lang) => {
    const body = termsBodies[lang];
    expect(body).toMatch(lang === 'fr' ? /<li><strong>« Agentics »<\/strong>/ : /<li><strong>"Agentics"<\/strong>/);
    const b9 = partB9(body);
    expect(b9).toMatch(/^<h2>B\.9 Almstins Agentics/);
    const numbers = [...b9.matchAll(/<strong>B\.9\.(\d+) /g)].map((m) => Number(m[1]));
    expect(numbers).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
  });

  const B92: Record<Lang, RegExp[]> = {
    en: [/never holds keys or seed phrases, never connects to a wallet/, /It does not stop or reverse a transaction, and it cannot/],
    es: [/nunca guarda claves ni seed phrases, nunca se conecta a una wallet/, /No detiene ni revierte una transacción, y no puede hacerlo/],
    fr: [/ne détient jamais de clés ni de seed phrases, ne se connecte jamais à un wallet/, /Il n'arrête ni n'annule une transaction, et ne le peut pas/],
  };
  const B93: Record<Lang, RegExp> = { en: /are not safety guarantees/, es: /no son garantías de seguridad/, fr: /ne sont pas des garanties de sécurité/ };
  const B97: Record<Lang, RegExp> = {
    en: /On a plan with a daily limit, a check that comes after the limit is reached is answered and not recorded, except one that comes back "flagged"; the check that finds the day full is recorded with a mark, so the Record shows where the day was cut\./,
    es: /En un plan con límite diario, una verificación posterior a alcanzar el límite se responde y no se registra, salvo una que resulte "flagged"; la verificación que encuentra el día completo se registra con una marca, de modo que el Registro muestra dónde se cortó el día\./,
    fr: /Avec un plan à limite quotidienne, une vérification postérieure à l'atteinte de la limite reçoit sa réponse et n'est pas enregistrée, sauf une qui revient « flagged » ; la vérification qui trouve la journée pleine est enregistrée avec une marque, de sorte que le Registre montre où la journée a été coupée\./,
  };
  const B97Cadence: Record<Lang, RegExp> = {
    en: /It is updated once a day, about once a minute while your Live page is open \(one agent at a time, in turn, up to a daily limit\), and when you ask, not in real time, and the newest minutes may not yet be read\./,
    es: /Se actualiza una vez al día, aproximadamente una vez por minuto mientras su página Live está abierta \(un agente a la vez, por turnos, hasta un límite diario\), y cuando usted lo pide, no en tiempo real, y es posible que los minutos más recientes aún no se hayan leído\./,
    fr: /Il est mis à jour une fois par jour, environ une fois par minute pendant que votre page Live est ouverte \(un agent à la fois, à tour de rôle, dans la limite d'un plafond quotidien\), et à votre demande, non en temps réel, et les toutes dernières minutes peuvent ne pas encore avoir été lues\./,
  };
  const B911: Record<Lang, RegExp> = {
    en: /with room for up to 500 more that come back "flagged"\. Past that a check is still answered, in full, but it is not recorded, and the answer says so; the check that finds the day full carries a mark in the Record\./,
    es: /con espacio para hasta 500 más que resulten "flagged"\. Superado eso, una verificación se sigue respondiendo, completa, pero no se registra, y la respuesta lo indica; la verificación que encuentra el día completo lleva una marca en el Registro\./,
    fr: /avec une marge pouvant aller jusqu'à 500 de plus qui reviennent « flagged »\. Au-delà, une vérification reçoit toujours sa réponse, complète, mais n'est pas enregistrée, et la réponse l'indique ; la vérification qui trouve la journée pleine porte une marque dans le Registre\./,
  };
  const B912: Record<Lang, RegExp> = {
    en: /does not link a Registered Address to a person \(P\.4\(b\)\) and does not monitor third parties/,
    es: /no vincula una Dirección Registrada con una persona \(P\.4\(b\)\) y no supervisa a terceros/,
    fr: /ne relie pas une Adresse Enregistrée à une personne \(P\.4\(b\)\) et ne surveille pas de tiers/,
  };

  it.each(LANGS)('%s: no custody and not in the transaction path (B.9.2), nothing is safe (B.9.3), no attribution and no watching of third parties (B.9.12)', (lang) => {
    const b9 = partB9(termsBodies[lang]);
    for (const re of B92[lang]) expect(clause(b9, 2)).toMatch(re);
    expect(clause(b9, 3)).toMatch(B93[lang]);
    expect(clause(b9, 12)).toMatch(B912[lang]);
  });

  it.each(LANGS)('%s: says what the daily limit does, the room for flagged checks and the mark, in the clauses that carry the numbers and the limits', (lang) => {
    const b9 = partB9(termsBodies[lang]);
    expect(clause(b9, 7)).toMatch(B97[lang]);
    expect(clause(b9, 7)).toMatch(B97Cadence[lang]);
    expect(clause(b9, 11)).toMatch(B911[lang]);
  });

  it('the room for flagged checks and the daily number in the Terms are the ones in entitlements.ts', () => {
    expect(source('src/lib/agentVault/entitlements.ts')).toContain('export const FLAGGED_LOGGED_PAST_LIMIT = 500;');
    expect(clause(partB9(termsBodies.en), 11)).toContain('room for up to 500 more');
  });

  it('English wording: Almstins never stops, blocks, prevents or halts, and every use of "safe" or "guarantee" is a denial', () => {
    const b9 = partB9(termsBodies.en).replace(/<[^>]+>/g, ' ');
    // Two places use the verb "stop", and neither says Almstins stops anything: a denial that it can, and a
    // removed address that stops being read. Take both phrases out and nothing may be left.
    const denial = /It does not stop or reverse a transaction, and it cannot/;
    const removal = /Removing an Agent or a Registered Address stops it being read/;
    expect(b9).toMatch(denial);
    expect(b9).toMatch(removal);
    const rest = b9.replace(denial, '').replace(removal, '');
    expect(rest.match(/\b(stops?|blocks?|blocked|prevents?|halts?)\b/gi) ?? []).toEqual([]);
    const sentences = b9.split(/(?<=[.;:])\s+/);
    for (const word of ['safe', 'safety', 'guarantee']) {
      for (const s of sentences.filter((x) => new RegExp(`\\b${word}`, 'i').test(x))) {
        expect(s, `"${word}" must be denied: ${s.slice(0, 120)}`).toMatch(/\b(not|never|no|nor|none)\b|n't/i);
      }
    }
    expect(b9).not.toMatch(/trustless|insured|risk[- ]free|scor(e|ing)\b/i);
  });

  it('Spanish and French: nothing is called safe without a denial next to it', () => {
    const es = partB9(termsBodies.es).replace(/<[^>]+>/g, ' ');
    const fr = partB9(termsBodies.fr).replace(/<[^>]+>/g, ' ');
    for (const s of es.split(/(?<=[.;:])\s+/).filter((x) => /\bseguro\b|\bsegura\b|seguridad/i.test(x) && /\bsegur[oa]\b/i.test(x))) {
      expect(s, s.slice(0, 120)).toMatch(/\b(no|nunca|ni)\b/i);
    }
    for (const s of fr.split(/(?<=[.;:])\s+/).filter((x) => /\bsûre?\b/i.test(x))) {
      expect(s, s.slice(0, 120)).toMatch(/\b(pas|jamais|ni|ne)\b|n'/i);
    }
  });

  const B97Every: Record<Lang, RegExp[]> = {
    en: [/every direct transfer of your Agent's own wallet, in either direction/, /with the transaction hash and the address on the other side/, /not on the list for a transfer to an address that was never registered, which the Record keeps and marks rather than omits/, /is marked as unmatched/, /recorded as a transfer to that contract, marked as a contract call/],
    es: [/todas las transferencias directas de la wallet propia de su Agente, en ambos sentidos/, /con el hash de la transacción y la dirección del otro extremo/, /que el Registro conserva y marca en lugar de omitir/, /se marca como sin correspondencia \("unmatched"\)/, /se registra como una transferencia a ese contrato, marcada como llamada a contrato/],
    fr: [/tous les transferts directs du wallet propre de votre Agent, dans les deux sens/, /avec le hash de la transaction et l'adresse de l'autre extrémité/, /que le Registre conserve et marque au lieu de l'omettre/, /est marquée comme sans correspondance \(« unmatched »\)/, /est enregistré comme un transfert vers ce contrat, marqué comme appel de contrat/],
  };
  const B91Every: Record<Lang, RegExp> = {
    en: /every direct transfer its own wallet makes or receives, each marked with whether the other side was one of your Registered Addresses/,
    es: /todas las transferencias directas que su wallet propia realiza o recibe, cada una con la marca de si el otro extremo era una de sus Direcciones Registradas/,
    fr: /tous les transferts directs que son wallet propre effectue ou reçoit, chacun portant la mention de ce que l'autre extrémité était ou non l'une de vos Adresses Enregistrées/,
  };
  it.each(LANGS)('%s: since slice 8 the Record covers every direct transfer of the own wallet and marks the other side (B.9.1, B.9.7), and no longer says an unregistered transfer is left out', (lang) => {
    const b9 = partB9(termsBodies[lang]);
    expect(clause(b9, 1)).toMatch(B91Every[lang]);
    for (const re of B97Every[lang]) expect(clause(b9, 7)).toMatch(re);
    const narrow: Record<Lang, RegExp> = { en: /It does not cover a transfer to an address that was never registered/, es: /No cubre una transferencia a una dirección que nunca se registró/, fr: /Il ne couvre pas un transfert vers une adresse qui n'a jamais été enregistrée/ };
    expect(clause(b9, 7)).not.toMatch(narrow[lang]);
  });

  const ESTABLISHED: Record<Lang, { b93: RegExp; b96: RegExp }> = {
    en: { b93: /"Established," and "Trusted" are not safety guarantees/, b96: /"consistent with history," shown as "Established," means the destination matches one your Agent asked about before/ },
    es: { b93: /"Established" y "Trusted" no son garantías de seguridad/, b96: /"consistent with history", que se muestra como "Established", significa/ },
    fr: { b93: /« Established » et « Trusted » ne sont pas des garanties de sécurité/, b96: /« consistent with history », affiché comme « Established », signifie/ },
  };
  it.each(LANGS)('%s: "Established", the word the pages show for consistent-with-history, is named in B.9.6 and denied as a safety guarantee in B.9.3', (lang) => {
    const b9 = partB9(termsBodies[lang]);
    expect(clause(b9, 3)).toMatch(ESTABLISHED[lang].b93);
    expect(clause(b9, 6)).toMatch(ESTABLISHED[lang].b96);
  });

  it('English: the Record is evidence of the check, not of the underlying transaction, and the limits are stated', () => {
    const b9 = partB9(termsBodies.en);
    expect(clause(b9, 7)).toMatch(/It does not show what your Agent did after an answer/);
    expect(clause(b9, 7)).toMatch(/not in real time/);
    expect(clause(b9, 7)).toMatch(/a transfer to an address that was never registered/);
    expect(clause(b9, 10)).toMatch(/not a warranty about the transactions in it/);
    expect(clause(b9, 6)).toMatch(/proves sameness, not ownership/);
    expect(clause(b9, 8)).toMatch(/not insurance/);
  });
});
