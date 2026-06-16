// Privacy Policy — footer-modal content, all user-visible copy (EN · ES · FR).
//
// Rendered by src/components/privacy-policy.astro (inline <details> on some pages,
// and as the footer "privacy-policy" modal via Footer.astro). The component takes a
// `lang` prop and selects the locale with getPrivacy(lang); the modal inherits the
// page's language from the Footer, so there are no per-locale routes for this surface.
//
// `body` is developer-controlled HTML rendered with set:html. Proper nouns (GitHub,
// Stripe, Alchemy, Turso…) and crypto jargon stay in English per design.claude.md.
//
// EN is authoritative. ES and FR display the English body until counsel finalizes the
// policy and a qualified legal translator produces the ES/FR versions.

import type { Lang } from '@/lib/i18n/locale';

export interface PrivacyLocale {
  lang: Lang;
  /** <summary> toggle text for the inline <details> variant. */
  summaryLabel: string;
  /** aria-label for the footer modal dialog. */
  ariaLabel: string;
  /** Full Privacy Policy body — HTML, rendered with set:html. */
  body: string;
}

export const en: PrivacyLocale = {
  lang: 'en',
  summaryLabel: 'Privacy Policy',
  ariaLabel: 'Privacy Policy',
  body: `
<h1>ALMSTINS PRIVACY POLICY</h1>
<p><strong>Effective Date:</strong> June 16, 2026 &nbsp;·&nbsp; <strong>Version:</strong> DRAFT 1.0<br/>
<strong>Operator:</strong> Almstins, a product of TitaniumHut ("Almstins," "we," "us," "our")</p>

<blockquote><p>⚠️ <strong>DRAFT — NOT YET LEGAL ADVICE.</strong> Prepared to be reviewed and finalized by a qualified attorney before publication. <code>[COUNSEL: …]</code> marks items needing legal judgment. This Policy is the companion to, and incorporated by reference into, the <strong>Almstins User Agreement</strong>. It covers <strong>Almstins only</strong>; <strong>PetroTins</strong> (tradfitins.com) has its own Privacy Policy.</p></blockquote>

<hr/>

<h2>1. Introduction</h2>
<p>This Privacy Policy explains what information Almstins collects, how we use and protect it, and the choices you have, when you use almstins.com and related applications and features (the "Service").</p>

<p><strong>Core principle — tenant isolation.</strong> Almstins operates under strict tenant isolation. Your data belongs to you, is segregated from every other user, is never accessed by operators, and is never used for any purpose other than providing the Service to you.</p>

<h2>2. Our Privacy Architecture (Binding Guarantees)</h2>
<p>These are architectural commitments that shape every section below:</p>

<ul>
  <li><strong>No attribution.</strong> We never link a blockchain address to a legal identity. We do not perform KYC, identity verification, address clustering, or de-anonymization, and we do not build any address-to-identity directory.</li>
  <li><strong>Tenant isolation.</strong> Every record is scoped to your account. No user — and no white-label operator — can access another tenant's data.</li>
  <li><strong>No surveillance.</strong> We do not track your off-platform behavior and do not proactively monitor third-party blockchain addresses. You provide the addresses and records you want organized.</li>
  <li><strong>Read-only, no custody.</strong> We never hold keys or move funds, so we never possess the credentials that would make your assets reachable through us.</li>
</ul>

<h2>3. Information We Collect</h2>

<h3>3.1 Information you provide directly</h3>
<ul>
  <li><strong>Account information:</strong> your email and subscription tier. <strong>We do not collect or store your name</strong> — a name supplied by an OAuth provider is discarded, and email/password signup asks only for an email. (Stripe may hold a billing name if you subscribe.)</li>
  <li><strong>Cryptocurrency data:</strong> wallet addresses you supply, public on-chain history for those addresses, and transaction records.</li>
  <li><strong>Financial data:</strong> exchange CSVs you import, transaction amounts, cost basis, and gains/losses.</li>
  <li><strong>Document attachments:</strong> receipt images, PDFs, and supporting documents you upload.</li>
  <li><strong>Community Content (if you use community features):</strong> fraud flags, address claims, and structured reviews you submit. See Section 6.</li>
  <li><strong>Communications:</strong> support tickets, feedback, and error reports.</li>
</ul>

<h3>3.2 Information collected automatically</h3>
<ul>
  <li><strong>Usage data:</strong> pages visited, features used, session duration.</li>
  <li><strong>Device information:</strong> browser type, operating system, and IP address (the latter also used for sanctions/geo controls).</li>
  <li><strong>Log data:</strong> timestamps of actions, error logs, API calls.</li>
  <li><strong>Analytics:</strong> aggregated, non-identifying usage patterns (see Section 9, Cookies &amp; Analytics).</li>
</ul>

<h3>3.3 Information we do NOT collect</h3>
<ul>
  <li>Private keys or seed phrases (we never request these).</li>
  <li>Exchange API keys or passwords (data is imported only via CSV or read by public address).</li>
  <li>Biometric identifiers or government IDs.</li>
  <li>Identity-linking data — we do not perform KYC.</li>
  <li>Bank account numbers or credit/debit card numbers (card data is handled solely by Stripe).</li>
</ul>

<h2>4. How We Use Information</h2>
<p>We use information only to:</p>
<ul>
  <li>Provide the Service to you (e.g., compute cost basis, render your dashboard, generate reports, run safety checks you request).</li>
  <li>Authenticate your account and prevent unauthorized access, fraud, and abuse.</li>
  <li>Operate community safety features in anonymized, aggregated form (Section 6).</li>
  <li>Respond to your support requests.</li>
  <li>Improve the Service through aggregated, non-identifying analytics.</li>
  <li>Comply with legal obligations and valid legal process.</li>
</ul>

<p><strong>We never</strong> use your information for advertising, profiling, targeted marketing, model training, or sale, and we never share it with third parties for their own commercial purposes.</p>

<h2>5. Blockchain Address Handling</h2>
<ul>
  <li><strong>What we collect:</strong> addresses you enter, addresses extracted from your imported CSVs, and addresses observed in public on-chain data for wallets you add. Counterparty addresses may be auto-added to your private address book to help you organize transactions.</li>
  <li><strong>Labels are private.</strong> Any label you apply (e.g., "Joe's Coffee") lives only in your account and is never published or shared across tenants.</li>
  <li><strong>No attribution.</strong> We never associate an address with a person or build a public address-to-identity map. Where you use your own records to evidence your own ownership, that is your voluntary self-disclosure — not something we perform on you or others.</li>
  <li><strong>Retention/deletion:</strong> addresses are retained while needed to provide the Service and per legal retention requirements; you may delete them subject to Section 8.</li>
</ul>

<h2>6. Community Safety Features (Flags, Reviews, Claims, Badges)</h2>
<p><em>Applies when and where these features are offered.</em></p>
<ul>
  <li><strong>What is stored:</strong> the fraud flag, structured review, or claim, keyed to a blockchain <strong>address</strong> — not to a person.</li>
  <li><strong>Reviews</strong> are predefined selections only (no free text, no star ratings); only <strong>aggregate counts</strong> are displayed, never an individual review or reviewer identity.</li>
  <li><strong>Reporter/claimant identity</strong> is stored solely for abuse-prevention and rate-limiting and is <strong>never displayed</strong> or linked to a person publicly or to other tenants.</li>
  <li><strong>Validation:</strong> surfaced fraud signals are gated by an independent third party (e.g., GoPlus); we do not publish a user headcount.</li>
  <li><strong>Claims and control proof:</strong> if you claim an address, any control-proof step (e.g., a signature you generate in your own wallet and provide to us) is used only to verify control; <strong>we never ask you to connect a wallet or provide keys.</strong></li>
  <li><strong>Corrections</strong> are handled by re-validation against the independent source, not by disclosing who contributed a signal. [COUNSEL: notice-and-correction workflow.]</li>
</ul>

<h2>7. Merchant Verification &amp; Camera Features</h2>
<p><em>Applies to the optional merchant tier, when offered.</em></p>
<ul>
  <li><strong>One-time scans</strong> (QR/address) are decoded <strong>on-device</strong>; no image is stored or transmitted by that action.</li>
  <li><strong>Continuous/always-on camera monitoring</strong>, if enabled by a merchant, may capture third parties (bystanders, employees, customers). <strong>The merchant is the controller of that capture</strong> and is responsible for obtaining required consents, posting notices, and observing retention limits under applicable biometric, surveillance, two-party-consent, and employee-monitoring laws. Almstins does not request or use such footage to identify individuals. [COUNSEL: biometric/BIPA, consent, retention; possible separate addendum and DPA.]</li>
</ul>

<h2>8. AI Features</h2>
<p>Optional AI features (transaction triage and receipt validation) send the relevant transaction data or uploaded receipt to our AI provider, <strong>Anthropic (Claude)</strong>, to generate suggestions you review and confirm. Outputs are not authoritative. [COUNSEL: confirm provider data-use terms; no-training assurance.]</p>

<h2>9. Cookies &amp; Analytics</h2>
<p>We use cookies and similar technologies for essential functionality and for aggregated analytics via <strong>Google Analytics</strong>. Where required, we present a consent mechanism and honor your choices. [COUNSEL: cookie banner/consent for EU ePrivacy; link to a Cookie Policy if maintained separately.]</p>

<h2>10. Third-Party Services</h2>
<p>We share the minimum necessary data with service providers that help us operate, including: <strong>GitHub &amp; Google</strong> (OAuth sign-in — we receive your email; the provider name/avatar is discarded), <strong>Stripe</strong> (billing; card data handled entirely by Stripe), <strong>Alchemy, Etherscan, Blockstream</strong> (public blockchain data), <strong>CoinGecko &amp; Coinpaprika</strong> (prices), <strong>GoPlus Security, VirusTotal, Chainabuse</strong> (address/site risk data), <strong>Anthropic</strong> (optional AI), <strong>Turso</strong> (database hosting, encrypted at rest), <strong>Render</strong> (hosting), <strong>Google Analytics</strong>, and an <strong>email/SMTP</strong> provider (verification, alerts, monthly digest). These providers have their own privacy practices; we are not responsible for their handling of data.</p>

<h2>11. Data Retention</h2>
<p>We retain data for as long as needed to provide the Service, to comply with legal obligations (including tax-record retention, typically 7+ years), and to resolve disputes and enforce our agreements. You may request deletion of your account and data at any time, subject to those legal retention requirements. Deletion is permanent and unrecoverable.</p>

<h2>12. Security</h2>
<p>We use industry-standard measures including HTTPS/TLS in transit, encryption at rest for sensitive data, role-based access control, and breach-response protocols. However, no system is fully secure, and we cannot guarantee absolute protection against all attacks or breaches. [COUNSEL: breach-notification commitments and timelines.]</p>

<h2>13. Legal Requests and Law Enforcement</h2>
<p>We may disclose data only when required by valid legal process (such as a subpoena or court order) or to investigate fraud or abuse with proper legal authority. <strong>We do not share data with chain-analysis firms or law enforcement absent valid legal process</strong>, and where legally permitted we will notify you of such requests. We do not honor informal requests.</p>

<h2>14. International Data Transfers</h2>
<p>Your data may be processed and stored in the United States or other countries. By using the Service, you consent to such transfer and processing, subject to applicable data-protection law. [COUNSEL: GDPR transfer mechanism (SCCs) if EU users are served.]</p>

<h2>15. Children's Privacy</h2>
<p>The Service is intended for users 18 and older. We do not knowingly collect data from minors and will delete such data if discovered.</p>

<h2>16. Your Rights</h2>
<p>Subject to applicable law (including GDPR and CCPA), you may:</p>
<ul>
  <li><strong>Access</strong> a copy of the data we hold about you;</li>
  <li><strong>Correct</strong> inaccurate data;</li>
  <li><strong>Delete</strong> your account and data (subject to legal holds);</li>
  <li><strong>Opt out</strong> of analytics and optional features;</li>
  <li><strong>Port</strong> your data via export in a standard format.</li>
</ul>
<p>We do not sell personal information and do not "share" it for cross-context behavioral advertising. To exercise any right, contact <strong>privacy@titaniumhut.com</strong>. [COUNSEL: CCPA "do not sell/share" statement; GDPR legal-bases table; verification and response-time procedures.]</p>

<h2>17. Changes to This Policy</h2>
<p>We may update this Policy. Material changes will be notified by email or in-product notice; continued use after the effective date constitutes acceptance.</p>

<h2>18. Contact</h2>
<p>Privacy Officer — Almstins / TitaniumHut — <strong>privacy@titaniumhut.com</strong></p>

<hr/>

<h2>SCHEDULE OF OPEN ITEMS FOR COUNSEL</h2>
<ol>
  <li>Cookie consent/banner for EU ePrivacy; whether to maintain a standalone Cookie Policy (Section 9).</li>
  <li>Biometric/BIPA, consent, signage, retention, controller/processor roles and a DPA for the merchant camera/continuous-monitoring feature (Section 7).</li>
  <li>AI provider data-use and no-training assurance (Section 8).</li>
  <li>Breach-notification commitments and timelines (Section 12).</li>
  <li>GDPR legal bases, international-transfer mechanism (SCCs), and CCPA "do not sell/share" disclosures and rights-request procedures (Sections 14, 16).</li>
  <li>Community-feature correction workflow consistent with no-attribution (Section 6).</li>
  <li>Confirm alignment with the User Agreement and that PetroTins is fully carved out.</li>
</ol>
`,
};

export const es: PrivacyLocale = {
  lang: 'es',
  summaryLabel: 'Política de Privacidad',
  ariaLabel: 'Política de Privacidad',
  // EN is authoritative; ES shows the English body until counsel finalizes
  // the policy and a qualified legal translator produces the Spanish version.
  body: en.body,
};

export const fr: PrivacyLocale = {
  lang: 'fr',
  summaryLabel: 'Politique de Confidentialité',
  ariaLabel: 'Politique de Confidentialité',
  // EN is authoritative; FR shows the English body until counsel finalizes
  // the policy and a qualified legal translator produces the French version.
  body: en.body,
};

const MAP: Record<Lang, PrivacyLocale> = { en, es, fr };

/** Select the Privacy locale for a language, falling back to English. */
export function getPrivacy(lang: Lang): PrivacyLocale {
  return MAP[lang] ?? en;
}
