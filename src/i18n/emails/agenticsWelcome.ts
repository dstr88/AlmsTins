// The Agentics welcome letter, sent once to a new account the first time it opens the Agentics
// door. English only for now.
//
// The words come from src/i18n/agentics.ts (`letter`), the same lines the welcome page shows,
// so the page and the email cannot drift apart. Email clients cannot resolve CSS variables, so
// the HTML writes out the values of the product's design tokens, as the other email templates do.

import { en as copy } from '@/i18n/agentics';

export interface RenderedAgenticsWelcome {
  subject: string;
  text: string;
  html: string;
}

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The letter as plain text and as a small HTML page. `appUrl` has no trailing slash. */
export function renderAgenticsWelcome(appUrl: string): RenderedAgenticsWelcome {
  const { letter } = copy;
  const docsUrl = `${appUrl}/agentics/docs`;
  const text = [
    letter.greeting,
    '',
    ...letter.paragraphs.flatMap((p) => [p, '']),
    `API docs: ${docsUrl}`,
    '',
    ...letter.signoff,
    '',
    letter.why,
  ].join('\n');

  const html = `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:540px;margin:0 auto;background:#0d131f;color:#f5f8ff;border-radius:12px;padding:28px 28px 24px;line-height:1.55;">
  <p style="margin:0 0 4px;color:#2dd4a8;font-size:12px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;">${esc(copy.brand)}</p>
  <h1 style="margin:0 0 16px;font-size:22px;">${esc(copy.welcome.h1)}</h1>
  <p style="margin:0 0 12px;color:#f5f8ff;">${esc(letter.greeting)}</p>
  ${letter.paragraphs.map((p) => `<p style="margin:0 0 12px;color:rgba(245,248,255,.78);font-size:15px;">${esc(p)}</p>`).join('\n  ')}
  <p style="margin:18px 0;"><a href="${esc(docsUrl)}" style="display:inline-block;background:#2dd4a8;color:#0a0f1a;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:700;">Read the API docs</a></p>
  <p style="margin:0;color:#f5f8ff;">${letter.signoff.map(esc).join('<br>')}</p>
  <p style="margin:18px 0 0;color:rgba(245,248,255,.45);font-size:12px;">${esc(letter.why)}</p>
</div>`.trim();

  return { subject: letter.subject, text, html };
}
