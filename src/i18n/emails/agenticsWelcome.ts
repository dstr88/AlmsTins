// The Agentics letters, as email: the welcome letter sent once to a new account the first time it
// opens the Agentics door, and the one email that goes to everyone who signed up while the vault was
// private, the day it opens. English only for now.
//
// The words come from src/i18n/agentics.ts, the same lines the welcome page shows, so the page and the
// email cannot drift apart. Email clients cannot resolve CSS variables, so the HTML writes out the
// values of the product's design tokens, as the other email templates do.

import { agenticsCopy, en as closedCopy, opening, type AgenticsCopy, type Letter } from '@/i18n/agentics';

export interface RenderedAgenticsWelcome {
  subject: string;
  text: string;
  html: string;
}

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * One letter as plain text and as a small HTML page. `appUrl` has no trailing slash; every link is on
 * this site, built from a path in the copy, and the address of the person it goes to is never in the body.
 */
function renderLetter(appUrl: string, brand: string, heading: string, letter: Letter): RenderedAgenticsWelcome {
  const links = letter.links.map((l) => ({ ...l, url: `${appUrl}${l.path}` }));
  const text = [
    letter.greeting,
    '',
    ...letter.paragraphs.flatMap((p) => [p, '']),
    ...links.map((l) => `${l.text}: ${l.url}`),
    '',
    ...letter.signoff,
    '',
    letter.why,
  ].join('\n');

  const html = `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:540px;margin:0 auto;background:#0d131f;color:#f5f8ff;border-radius:12px;padding:28px 28px 24px;line-height:1.55;">
  <p style="margin:0 0 4px;color:#2dd4a8;font-size:12px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;">${esc(brand)}</p>
  <h1 style="margin:0 0 16px;font-size:22px;">${esc(heading)}</h1>
  <p style="margin:0 0 12px;color:#f5f8ff;">${esc(letter.greeting)}</p>
  ${letter.paragraphs.map((p) => `<p style="margin:0 0 12px;color:rgba(245,248,255,.78);font-size:15px;">${esc(p)}</p>`).join('\n  ')}
  <p style="margin:18px 0;">${links
    .map(
      (l, i) =>
        `<a href="${esc(l.url)}" style="display:inline-block;background:${i === 0 ? '#2dd4a8' : '#161d2c'};color:${i === 0 ? '#0a0f1a' : '#f5f8ff'};padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:700;${links.length > 1 ? 'margin:0 8px 8px 0;' : ''}">${esc(l.button)}</a>`,
    )
    .join(' ')}</p>
  <p style="margin:0;color:#f5f8ff;">${letter.signoff.map(esc).join('<br>')}</p>
  <p style="margin:18px 0 0;color:rgba(245,248,255,.45);font-size:12px;">${esc(letter.why)}</p>
</div>`.trim();

  return { subject: letter.subject, text, html };
}

/**
 * The welcome letter. With no copy given it is the letter of the private vault ("opening soon"); a new
 * account gets the letter of the state the vault is in (agenticsCopy), sent once.
 */
export function renderAgenticsWelcome(appUrl: string, copy: AgenticsCopy = closedCopy): RenderedAgenticsWelcome {
  return renderLetter(appUrl, copy.brand, copy.welcome.h1, copy.letter);
}

/** The state's letter: `renderAgenticsWelcome` with the copy for whether the vault is open. */
export function renderAgenticsWelcomeFor(appUrl: string, vaultOpen: boolean): RenderedAgenticsWelcome {
  return renderAgenticsWelcome(appUrl, agenticsCopy(vaultOpen));
}

/** The one email to everyone who signed up before the vault opened, sent the day it does. */
export function renderAgenticsOpening(appUrl: string): RenderedAgenticsWelcome {
  return renderLetter(appUrl, closedCopy.brand, opening.heading, opening.letter);
}
