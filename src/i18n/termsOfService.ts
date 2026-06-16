// User Agreement — replaces the prior Terms of Service as of 2026-06-16.
// EN is the authoritative language. ES and FR display the English body until
// counsel finalizes the agreement and a qualified legal translator produces
// reviewed ES/FR versions.
//
// `body` is developer-controlled HTML rendered with set:html (legal markup with
// <strong>/<ul>/<a>, etc.). Crypto jargon (wallet, token, phishing, honeypot,
// blockchain) and all proper nouns (Almstins, Stripe, OFAC, Tennessee…) are kept
// in English per design.claude.md.

import type { Lang } from '@/lib/i18n/locale';

export interface TermsLocale {
  lang: Lang;
  /** <summary> toggle text for the inline <details> variant. */
  summaryLabel: string;
  /** aria-label for the footer modal dialog. */
  ariaLabel: string;
  /** Full User Agreement body — HTML, rendered with set:html. */
  body: string;
}

export const en: TermsLocale = {
  lang: 'en',
  summaryLabel: 'User Agreement',
  ariaLabel: 'User Agreement',
  body: `
<h1>ALMSTINS USER AGREEMENT</h1>

<p><strong>Effective Date:</strong> June 16, 2026 &nbsp;·&nbsp; <strong>Version:</strong> DRAFT 1.0<br/>
<strong>Operator:</strong> Almstins, a product of TitaniumHut ("Almstins," "we," "us," "our")</p>

<blockquote><p>⚠️ <strong>DRAFT — NOT YET LEGAL ADVICE.</strong> This document was prepared to be reviewed and finalized by a qualified attorney before it is published or relied upon. It is written to be protective and comprehensive, but it has not been reviewed by counsel. Items in <strong>[COUNSEL: …]</strong> brackets mark decisions that require a lawyer's judgment. Do not rely on this as your operative agreement until counsel has approved it and it is properly presented to users for assent (clickwrap).</p></blockquote>

<blockquote><p><strong>Scope &amp; precedence.</strong> This is the single canonical contract governing your use of Almstins. It is organized as <strong>Part A — General Terms</strong> (apply to all of Almstins) and <strong>Part B — Supplemental Terms</strong> (apply only to specific features, called "Surfaces"). If a Part B Supplemental Term conflicts with a Part A General Term, <strong>the Supplemental Term controls for that Surface only.</strong> The <strong>Privacy Policy</strong> is incorporated by reference. <strong>PetroTins</strong> (tradfitins.com) is a separate product governed by its own terms and is <strong>not</strong> covered by this Agreement.</p></blockquote>

<hr/>

<h2>PREAMBLE — ACCEPTANCE AND ARCHITECTURAL BOUNDARIES</h2>

<p><strong>P.1 Agreement.</strong> By accessing or using Almstins in any way — including visiting the website, using the public wallet or website checker, creating an account, or subscribing — you acknowledge that you have read, understood, and agree to be bound by this User Agreement and the Privacy Policy. <strong>If you do not agree, do not use Almstins.</strong></p>

<p><strong>P.2 Who may agree.</strong> You represent that you are at least 18 years old and have the legal capacity and authority to enter into this Agreement.</p>

<p><strong>P.3 What Almstins is.</strong> Almstins is informational software: a cryptocurrency portfolio tracker, bookkeeping tool, and safety-verification platform. Almstins is <strong>not</strong> a wallet, exchange, broker, custodian, money transmitter, payment processor, investment adviser, tax preparer, accountant, law firm, or compliance/AML service. Almstins is currently offered on a <strong>beta</strong> basis and is intended for exploration and organization, not as a sole source of financial, tax, or legal truth.</p>

<p><strong>P.4 Architectural Trust Boundaries (these govern every Surface).</strong> The following are architectural guarantees, not merely promises. They define what Almstins is and constrain everything below:</p>

<ul>
<li><strong>(a) Read-only · no custody · no movement.</strong> Almstins never holds private keys, never requests signing permission, and never initiates, routes, settles, or moves any transaction or asset. A compromise of Almstins cannot move your funds.</li>
<li><strong>(b) No attribution.</strong> Almstins never links a blockchain address to a legal identity. We do not perform KYC, identity verification, address clustering, or de-anonymization. "Who is the person behind this wallet?" is permanently out of scope. The permitted opposite — you using your own records to evidence your own ownership — is supported.</li>
<li><strong>(c) Tenant isolation.</strong> Your data is isolated from every other user and from any operator. No user, and no white-label operator, can access another tenant's or any end user's data.</li>
<li><strong>(d) White-label purpose limit.</strong> Any white-label or embedded deployment provides software and branding only — never a window into users, and never a tool to monitor, profile, or track third parties.</li>
</ul>

<p><strong>P.5 Changes.</strong> We may modify this Agreement. Material changes will be notified by email or in-product notice and become effective for existing users thirty (30) days after posting (immediately for new users). Continued use after the effective date constitutes acceptance. [COUNSEL: confirm notice mechanics.]</p>

<hr/>

<h1>PART A — GENERAL TERMS</h1>

<h2>A.1 Definitions</h2>
<ul>
<li><strong>"Service" / "Almstins"</strong> — all Almstins websites, applications, APIs, and features.</li>
<li><strong>"Surface"</strong> — a distinct feature area governed by a Part B Supplemental Term (e.g., the Public Checker, the Tracker, the Community Trust Layer).</li>
<li><strong>"Visitor"</strong> — any person using a Surface without signing in.</li>
<li><strong>"Member"</strong> — a person with an Almstins account (free or paid).</li>
<li><strong>"Community Content"</strong> — fraud flags, address claims, reviews, and any other user-contributed signal.</li>
<li><strong>"Content"</strong> — any data, text, images, documents, or other material you provide or upload.</li>
<li><strong>"Third-Party Services"</strong> — external services Almstins integrates with or links to.</li>
</ul>

<h2>A.2 Eligibility, Sanctions &amp; Geographic Restrictions</h2>
<p><strong>A.2.1</strong> You must be 18+ and legally permitted to use the Service in your jurisdiction.<br/>
<strong>A.2.2</strong> You represent and warrant that you are not a person with whom transactions are prohibited under economic or trade sanctions laws (including U.S. OFAC programs), and that you are not located in, ordinarily resident in, or accessing the Service from any comprehensively sanctioned jurisdiction — <strong>including Cuba, Iran, North Korea, Syria, or the Crimea, Donetsk, or Luhansk regions of Ukraine.</strong><br/>
<strong>A.2.3</strong> We do not offer the Service to, or conduct business with, any individual, entity, or jurisdiction restricted under applicable sanctions laws or prohibited by our payment or compliance providers.<br/>
<strong>A.2.4</strong> We apply geographic access controls (including IP-based geo-blocking) on a best-effort basis; these controls may fail open and are not guaranteed. [COUNSEL: fail-open vs. fail-closed; enumerated list vs. general statement; SDN name-screening for the free tier.]</p>

<h2>A.3 Accounts and Sign-In</h2>
<p><strong>A.3.1</strong> You may sign in via supported OAuth providers (Google, GitHub) or by email. We do not collect or store your name; a provider-supplied name is discarded.<br/>
<strong>A.3.2</strong> You are responsible for safeguarding access to your account and for all activity under it. Notify us promptly of any unauthorized use.<br/>
<strong>A.3.3</strong> We may suspend or terminate accounts as set out in A.17.</p>

<h2>A.4 License to Use the Service</h2>
<p>Subject to this Agreement, we grant you a limited, non-exclusive, non-transferable, non-sublicensable, revocable license to access and use the Service for your personal or internal business record-keeping and safety-verification purposes. All rights not expressly granted are reserved.</p>

<h2>A.5 Acceptable Use</h2>
<p>You will not, and will not attempt to: (a) provide false or misleading information; (b) use the Service in violation of any law or to facilitate illegal activity, money laundering, terrorist financing, fraud, or sanctions evasion; (c) impersonate any person or entity or misrepresent your affiliation; (d) access, tamper with, or use non-public areas or other users' data; (e) reverse engineer, decompile, or derive source code except as permitted by law; (f) interfere with, disrupt, overburden, or degrade the Service; (g) circumvent rate limits, access controls, or usage quotas; (h) use any robot, spider, scraper, or automated means to access the Service or extract data except as expressly permitted; (i) harvest or collect data enabling contact with individuals or entities, or use Service data for direct marketing; or (j) submit Community Content in violation of Part B.4. Any unauthorized use terminates the licenses granted herein.</p>

<h2>A.6 Intellectual Property</h2>
<p>The Service, and all related software, content, and trademarks ("Almstins Marks"), are owned by Almstins and its licensors and protected by law. Except as expressly permitted (including the limited merchant trademark license in B.5), you may not use the Almstins Marks without our prior written consent. Open-source components remain governed by their respective licenses.</p>

<h2>A.7 Your Data and Content</h2>
<p><strong>A.7.1</strong> As between you and Almstins, your Content is yours. We claim <strong>no</strong> ownership of it.<br/>
<strong>A.7.2</strong> You grant us only the limited license necessary to host, process, and display your Content <strong>to you</strong> for the purpose of operating the Service (for example, computing cost basis, rendering your dashboard, generating your reports). We do not use your Content for advertising, profiling, resale, or training, and we do not share it with third parties except as described in the Privacy Policy. (Community Content is licensed separately under B.4.)<br/>
<strong>A.7.3</strong> You represent that you have the right to provide your Content and that it does not infringe the rights of others.</p>

<h2>A.8 Third-Party Services</h2>
<p>The Service integrates with and relies on Third-Party Services, which may include GitHub and Google (sign-in), Stripe (billing), Alchemy, Etherscan, Blockstream (blockchain data), CoinGecko and Coinpaprika (prices), GoPlus Security, VirusTotal, and Chainabuse (risk data), Anthropic/Claude (optional AI features), Turso (database), Render (hosting), Google Analytics, and an email/SMTP provider. We share only the minimum data necessary. We are not responsible for Third-Party Services, and your use of them may be governed by their own terms. We do not endorse and are not liable for any third-party site, protocol, exchange, or "ecosystem partner" you reach through or evaluate using the Service.</p>

<h2>A.9 Subscriptions, Billing, Renewal, and Refunds</h2>
<p><strong>A.9.1</strong> Paid plans and their features and prices are published on the Service. Billing is handled by Stripe; we do not see or store your card details.<br/>
<strong>A.9.2 Auto-renewal.</strong> Paid subscriptions renew automatically at the then-current price until cancelled. You authorize recurring charges. [COUNSEL: confirm auto-renewal disclosure satisfies California ARL and EU requirements.]<br/>
<strong>A.9.3 Cancellation.</strong> You may cancel at any time; cancellation stops future renewals and takes effect at the end of the current billing period.<br/>
<strong>A.9.4 Refunds.</strong> [COUNSEL: insert refund policy.]<br/>
<strong>A.9.5 Price changes.</strong> We may change prices with prior notice; changes apply to the next billing cycle.</p>

<h2>A.10 Disclaimer of Warranties</h2>
<p>TO THE FULLEST EXTENT PERMITTED BY LAW, THE SERVICE IS PROVIDED "AS IS" AND "AS AVAILABLE," WITH ALL FAULTS AND WITHOUT WARRANTIES OF ANY KIND, WHETHER EXPRESS, IMPLIED, OR STATUTORY, INCLUDING IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, TITLE, AND NON-INFRINGEMENT. WE DO NOT WARRANT THAT THE SERVICE WILL BE UNINTERRUPTED, TIMELY, SECURE, ERROR-FREE, OR THAT ANY DATA, PRICE, CALCULATION, OR SAFETY RESULT WILL BE ACCURATE, COMPLETE, OR RELIABLE. NO ADVICE OR INFORMATION OBTAINED FROM THE SERVICE CREATES ANY WARRANTY NOT EXPRESSLY STATED HERE.</p>

<h2>A.11 Limitation of Liability</h2>
<p><strong>A.11.1</strong> TO THE FULLEST EXTENT PERMITTED BY LAW, IN NO EVENT WILL ALMSTINS OR ITS OPERATORS, AFFILIATES, OR SUPPLIERS BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, EXEMPLARY, OR PUNITIVE DAMAGES, OR FOR ANY LOSS OF PROFITS, REVENUE, DATA, CRYPTOCURRENCY, OR DIGITAL ASSETS, OR FOR LOSSES ARISING FROM YOUR RELIANCE ON ANY SAFETY RESULT, PRICE, CALCULATION, OR TAX FIGURE, OR FROM ANY TRANSACTION YOU CHOOSE TO MAKE OR NOT MAKE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGES.<br/>
<strong>A.11.2 Cap.</strong> OUR TOTAL AGGREGATE LIABILITY FOR ANY CLAIM ARISING OUT OF OR RELATING TO THE SERVICE WILL NOT EXCEED THE GREATER OF (i) THE AMOUNTS YOU PAID US FOR THE SERVICE IN THE TWELVE (12) MONTHS PRECEDING THE CLAIM, OR (ii) ONE HUNDRED U.S. DOLLARS ($100). [COUNSEL: confirm cap.]<br/>
<strong>A.11.3 Free Surfaces.</strong> FOR ANY SURFACE YOU USE WITHOUT PAYMENT (INCLUDING THE PUBLIC CHECKER), TO THE EXTENT PERMITTED BY LAW YOUR SOLE REMEDY IS TO STOP USING IT, AND YOU ARE LIMITED TO INJUNCTIVE RELIEF.<br/>
<strong>A.11.4</strong> Paid safety Surfaces carry their own scope and limitations as set out in B.5. Nothing in this Section excludes liability that cannot be excluded by law (such as for fraud or death/personal injury caused by our negligence).</p>

<h2>A.12 Indemnification</h2>
<p>You agree to indemnify, defend, and hold harmless Almstins and its operators, affiliates, and suppliers from any claims, losses, liabilities, damages, costs, and expenses (including reasonable attorneys' fees) arising out of or relating to: (a) your Content or Community Content; (b) your use of, or inability to use, the Service; (c) your violation of this Agreement; (d) your violation of any law or any right of any third party (including any business or address owner affected by a flag, review, claim, or badge you submit); or (e) any transaction you enter. We may assume exclusive defense of any matter subject to indemnification, and you will cooperate.</p>

<h2>A.13 Your Responsibilities; Accuracy</h2>
<p>You are solely responsible for the accuracy and completeness of all data you provide or import. Almstins cannot verify imported CSVs, synced data, or manual entries. Incomplete or incorrect data will produce unreliable outputs, which flow through to reports, P&amp;L, and tax figures. You must verify completeness (all sources imported, all syncs successful) and accuracy (prices, classifications, cost basis) yourself.</p>

<h2>A.14 Availability, Changes, Data Loss, Force Majeure</h2>
<p>The Service may experience downtime, outages, errors, or interruptions, and features may be modified, deprecated, or discontinued at any time. While we maintain reasonable backups, no system is fully secure against loss or corruption; you should keep your own backups, and deleted data is permanent and unrecoverable. We are not liable for delays or failures caused by events beyond our reasonable control.</p>

<h2>A.15 Term and Termination</h2>
<p>This Agreement applies while you use the Service. You may stop using the Service at any time. We may suspend or terminate your access for any reason in our discretion, including breach of this Agreement, without liability. Provisions that by their nature should survive (including A.6, A.7, A.10–A.12, A.18–A.21, and applicable Part B disclaimers) survive termination. If your access is terminated, you will not attempt to re-access through another account.</p>

<h2>A.16 Compliance with Laws</h2>
<p>You agree to use the Service only in compliance with all applicable laws, including tax, sanctions/AML, securities, export-control, and privacy laws. You warrant that your use is lawful in your jurisdiction.</p>

<h2>A.17 No Professional Advice</h2>
<p>Almstins does not provide and expressly disclaims tax, financial, investment, legal, or accounting advice. Outputs are informational only. You must consult a qualified professional before filing taxes, making investment decisions, or relying on any output for a legal or financial purpose.</p>

<h2>A.18 Dispute Resolution; Arbitration; Class Waiver</h2>
<p><strong>A.18.1 Informal resolution first.</strong> Before filing any claim, you agree to contact support@titaniumhut.com with a description of the dispute and to attempt good-faith resolution for thirty (30) days.<br/>
<strong>A.18.2 Binding arbitration.</strong> If not resolved, any dispute arising out of or relating to this Agreement or the Service will be resolved by <strong>final and binding arbitration</strong>, not in court, except as stated below. Arbitration will be seated in <strong>Cookeville, Tennessee</strong>, conducted in English. [COUNSEL: select arbitral body/rules; confirm seat.]<br/>
<strong>A.18.3 Class-action waiver.</strong> Disputes will be conducted only on an individual basis. You and Almstins waive any right to bring or participate in a class, collective, consolidated, or representative action. [COUNSEL: enforceability review.]<br/>
<strong>A.18.4 Exceptions.</strong> Either party may bring an individual claim in small-claims court and may seek injunctive relief to protect intellectual property.</p>

<h2>A.19 Governing Law</h2>
<p>This Agreement is governed by the laws of the <strong>State of Tennessee</strong>, without regard to conflict-of-laws rules. Subject to A.18, the exclusive venue for any permitted court action is the state or federal courts located in <strong>Cookeville, Tennessee</strong>.</p>

<h2>A.20 General Provisions</h2>
<p>This Agreement (with the Privacy Policy and any Supplemental Terms) is the entire agreement between you and Almstins and supersedes prior agreements. If any provision is unenforceable, it will be reformed to the minimum extent necessary and the remainder stays in effect. You may not assign this Agreement; we may. Our failure to enforce a provision is not a waiver. Headings are for convenience only.</p>

<h2>A.21 Contact</h2>
<p>Legal: legal@titaniumhut.com · Support: support@titaniumhut.com · Privacy: privacy@titaniumhut.com</p>

<hr/>

<h1>PART B — SUPPLEMENTAL TERMS (BY SURFACE)</h1>

<h2>B.1 Public Wallet &amp; Website Safety Checker (free, no login)</h2>
<p><strong>B.1.1</strong> The Checker reports safety information about a blockchain address or website by querying third-party databases (including GoPlus, OFAC lists, honeypot detection, Etherscan/Alchemy, Chainabuse, MetaMask, ScamSniffer, URLScan, OpenPhish, and VirusTotal).<br/>
<strong>B.1.2 Attribution, not verdict.</strong> All findings are <strong>reported from third-party sources and are not independently verified by Almstins.</strong> A result indicating no detected threat means only that no source has flagged the item <strong>at this time</strong> — it is <strong>not</strong> a guarantee of safety, legitimacy, or quality. A result indicating a detected risk reflects a third-party report, not a legal determination.<br/>
<strong>B.1.3 No reliance.</strong> The Checker is informational and is not financial, legal, or security advice. You must exercise your own judgment and conduct your own research before transacting. To the extent permitted by law, Almstins has no liability for any action you take or do not take based on a Checker result. [COUNSEL: review the imperative "do not connect" wording for added exposure.]<br/>
<strong>B.1.4</strong> The Checker is provided free and best-effort; A.11.3 applies.<br/>
<strong>B.1.5</strong> Automated or bulk access to the Checker is prohibited except under a separate written agreement.</p>

<h2>B.2 Portfolio &amp; Wallet Tracker (read-only)</h2>
<p><strong>B.2.1</strong> The Tracker reads public blockchain data for addresses <strong>you supply</strong> and data <strong>you import</strong>. You never connect a wallet and never provide keys or signing permission.<br/>
<strong>B.2.2</strong> You are responsible for the accuracy and completeness of supplied addresses and imported records (A.13).<br/>
<strong>B.2.3</strong> On-chain and exchange figures may differ due to caching, dust filtering, unpriced or scam tokens, sync timing, and the limits of third-party data. Displayed values are estimates, not statements of account.</p>

<h2>B.3 Bookkeeping, Tax Breakdown &amp; Year Summary</h2>
<p><strong>B.3.1 Not tax advice; no filing.</strong> Bookkeeping, cost-basis, gain/loss, reconciliation, and Year Summary outputs are <strong>informational only</strong>. Almstins does not file returns, does not determine your tax liability, and does not provide tax advice. You must consult a qualified tax professional, who may override or recalculate any figure.<br/>
<strong>B.3.2 Method.</strong> Cost basis is computed using weighted-average cost unless otherwise stated; other methods, wash-sale tracking, state/local tax, and non-US jurisdictions are your responsibility.<br/>
<strong>B.3.3 No guarantee of treatment.</strong> Even if a calculation is accurate, tax authorities may treat a transaction differently; Almstins is not liable for any assessment, penalty, interest, audit, or dispute.<br/>
<strong>B.3.4 Historical data.</strong> Older or pre-2018 transactions may lack on-chain verification or pricing; gaps from failed exchanges or lost access must be reconstructed by you. Almstins can help organize reconstructed data but cannot supply missing data.</p>

<h2>B.4 Community Trust Layer — Flags, Reviews, Claims, Badges</h2>
<blockquote><p><em>This Surface may not be enabled in all regions or at all times. Terms apply when and where it is offered.</em></p></blockquote>

<p><strong>B.4.1 What it is.</strong> Members may contribute <strong>fraud flags</strong>, <strong>reviews</strong>, and <strong>address claims</strong>, which may surface aggregated, anonymized safety signals (including a <strong>trust badge</strong>) to other users. Reading safety information is open to all; <strong>contributing</strong> is gated by membership tier as described in-product.<br/>
<strong>B.4.2 License and representations.</strong> You grant Almstins a worldwide, royalty-free, sublicensable license to store, aggregate, display, and distribute your Community Content in anonymized and aggregated form for the purpose of operating the Surface. You represent that each contribution is made in good faith and is accurate to the best of your knowledge, and that you have the firsthand basis described below.<br/>
<strong>B.4.3 Reviews — verified interaction; structured only.</strong> Reviews are limited to predefined selections (e.g., "transaction completed as expected," "did not receive what was expected," "suspected fraud"); <strong>no free text, no star ratings, and no reviewer identity is collected or displayed.</strong> Only aggregate counts are shown. You may review an address only where your tracked records reflect a transaction with that address; by submitting a review you represent that you transacted with it. One review per member per address (latest value controls).<br/>
<strong>B.4.4 Claims — control proof; anti-impersonation.</strong> Claiming an address asserts that <strong>you control it.</strong> Claiming is on a first-claimer basis. You may be required to prove control through an out-of-band method (for example, a wallet-generated signature of a one-time message that you provide to us) — <strong>Almstins never asks you to connect a wallet or provide keys.</strong> Claiming an address you do not control, or to impersonate a business, is prohibited and a material breach, and you indemnify Almstins for resulting claims (A.12).<br/>
<strong>B.4.5 Trust badge disclaimer.</strong> A trust badge means only that an address has been claimed by a verified member and was clear of automated checks at the relevant time. <strong>It is NOT a guarantee of safety, legitimacy, solvency, or quality, and is not a recommendation.</strong> Where both a badge and a fraud signal exist, both are shown; you must consider all displayed signals before transacting. This disclaimer is also presented at the point of display.<br/>
<strong>B.4.6 Moderation; no duty to monitor.</strong> Almstins may remove, refuse, or decline to surface any flag, review, or claim, and may investigate suspected abuse, <strong>in its sole discretion and with no obligation to pre-screen or monitor.</strong> We assume no liability for surfacing or not surfacing any Community Content.<br/>
<strong>B.4.7 Objective gating; dispute and correction.</strong> Surfaced fraud signals are gated by independent third-party validation (e.g., GoPlus), not by user vote or headcount. A business or address owner who believes a signal is in error may request review; <strong>because Almstins does not attribute contributions to identities, correction is handled through re-validation against the independent source and removal where appropriate, not by disclosing who contributed a signal.</strong> [COUNSEL: define notice-and-correction workflow; defamation/disparagement review of aggregate signals.]<br/>
<strong>B.4.8 No attribution preserved.</strong> Who contributed a flag, review, or claim is stored only for abuse-prevention and is never displayed or linked to a person.</p>

<h2>B.5 Merchant / Anti-MITM Verification Tier (paid)</h2>
<blockquote><p><em>Planned/optional paid Surface. Terms apply when and where it is offered. A separate Merchant Addendum may apply.</em></p></blockquote>

<p><strong>B.5.1 Not money transmission.</strong> The merchant tier is a flat software subscription. Almstins never touches, holds, routes, or settles funds and takes no per-transaction fee. The term "merchant account" refers only to this software feature and does not imply payment processing or money transmission. [COUNSEL: confirm terminology.]<br/>
<strong>B.5.2 Paid safety service — scope and limits.</strong> The tier may provide address verification and monitoring/alerting on a defined, best-effort basis. <strong>It does not guarantee detection of every address swap, tampering, or fraud, and is not insurance.</strong> Service levels, if any, are as published. To the extent permitted by law, Almstins' liability for any failure to detect or alert is subject to A.11, and you acknowledge that monitoring is a tool, not a guarantee of outcome. [COUNSEL: SLA language; whether any uptime/detection commitment is made.]<br/>
<strong>B.5.3 Trademark license for verification markings.</strong> If you display Almstins verification markings (e.g., a "verified" sticker) on your own signage, we grant a limited, revocable, non-transferable license to do so solely in accordance with our brand-use guidelines. The <strong>scan</strong>, not the marking, is the source of truth. We may revoke this license for misuse. [COUNSEL: brand-use guidelines; quality control.]<br/>
<strong>B.5.4 "Verified" representations.</strong> A verified scan or badge attests only that an address is claimed by a paying member and clear of automated checks at scan time. It does <strong>not</strong> attest that any business is legitimate, solvent, or safe, and is not a recommendation; consumers must exercise their own judgment. [COUNSEL: consumer-reliance exposure by jurisdiction.]<br/>
<strong>B.5.5 Lapse.</strong> Verification status may persist after a subscription lapses to avoid misleading consumers relying on physical signage; the recurring fee buys monitoring, alerts, bookkeeping, and additional capacity, not the verification itself. [COUNSEL: what is represented about a lapsed merchant; badge wording post-lapse.]<br/>
<strong>B.5.6 Camera, scanning, and monitoring; consent.</strong> One-time QR/address scans are decoded on-device; no image is stored or transmitted by that action. Any <strong>continuous or always-on camera monitoring</strong> option may capture third parties (bystanders, employees, customers) and may be subject to biometric, surveillance, two-party-consent, and employee-monitoring laws that vary by jurisdiction. If you enable such monitoring, <strong>you are the controller of that capture and are solely responsible</strong> for obtaining all required consents, posting required notices, and complying with retention limits; you indemnify Almstins for your use of it. [COUNSEL: biometric/BIPA, consent, signage, retention; possible separate addendum.]<br/>
<strong>B.5.7 Merchant bookkeeping.</strong> Bookkeeping applied to received payments is governed by B.3.</p>

<h2>B.6 Alerts (Price and DeFi Health)</h2>
<p><strong>B.6.1</strong> Price-threshold and Aave health-factor alerts are delivered on a best-effort basis (typically by email). We do not guarantee timely or successful delivery, and you should not rely on alerts as your sole risk control.<br/>
<strong>B.6.2 No automated action.</strong> Almstins never trades, repays debt, adjusts positions, or moves any asset on your behalf. Alerts are informational only.</p>

<h2>B.7 AI Features (AI Triage, Receipt Validation)</h2>
<p><strong>B.7.1</strong> Optional, paid AI features process selected transaction data and uploaded receipts via a third-party model provider (Anthropic/Claude). Outputs are suggestions for your review and confirmation, are <strong>not</strong> authoritative, and may be incorrect.<br/>
<strong>B.7.2</strong> By using these features you consent to the necessary processing described in the Privacy Policy. Do not upload documents you are not permitted to share.</p>

<h2>B.8 PetroTins — Excluded</h2>
<p>PetroTins is a separate product offered at tradfitins.com under its own Terms and Privacy Policy. This Agreement does not govern PetroTins. [COUNSEL: confirm carve-out adequacy; whether a shared agreement is preferable.]</p>

<hr/>

<h2>SCHEDULE OF OPEN ITEMS FOR COUNSEL</h2>
<ol>
<li>Sanctions: general vs. enumerated clause; free-tier screening; fail-open vs. fail-closed (A.2.4).</li>
<li>Liability cap amount and free/paid split (A.11); paid-merchant SLA and detection commitments (B.5.2).</li>
<li>Arbitration body/rules, seat, and class-waiver enforceability (A.18).</li>
<li>Auto-renewal disclosure (CA ARL / EU) and refund policy (A.9).</li>
<li>Community layer: verified-interaction and control-proof sufficiency; no-attribution correction workflow; defamation exposure of aggregate signals (B.4).</li>
<li>Merchant tier: trademark/brand-use terms; "verified" reliance; lapsed-badge wording; camera/biometric/continuous-monitoring consent and possible separate addendum (B.5).</li>
<li>Checker "do not connect" directive wording (B.1.3).</li>
<li>PetroTins carve-out vs. shared agreement (B.8).</li>
<li>Clickwrap assent flow and versioning so this remains the single canonical contract.</li>
</ol>
`,
};

export const es: TermsLocale = {
  lang: 'es',
  summaryLabel: 'Acuerdo de Usuario',
  ariaLabel: 'Acuerdo de Usuario',
  body: en.body,
};

export const fr: TermsLocale = {
  lang: 'fr',
  summaryLabel: "Accord d'utilisateur",
  ariaLabel: "Accord d'utilisateur",
  body: en.body,
};

const MAP: Record<Lang, TermsLocale> = { en, es, fr };

/** Select the User Agreement locale for a language, falling back to English. */
export function getTerms(lang: Lang): TermsLocale {
  return MAP[lang] ?? en;
}
