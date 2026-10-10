// Privacy Policy — footer-modal content, all user-visible copy (EN · ES · FR).
//
// Operative Privacy Policy v1.2 (effective 2026-10-12; set this and the three body dates to the deploy day).
// ES and FR are first-pass legal translations pending review by a fluent legal translator
// (including the v1.2 changes to Sections 1 through 13 and 16).
//
// Rendered by src/components/privacy-policy.astro (inline <details> on some pages,
// and as the footer "privacy-policy" modal via Footer.astro). The component takes a
// `lang` prop and selects the locale with getPrivacy(lang); the modal inherits the
// page's language from the Footer, so there are no per-locale routes for this surface.
//
// `body` is developer-controlled HTML rendered with set:html. Proper nouns (GitHub,
// Stripe, Alchemy, Render…) and crypto jargon stay in English per design.claude.md.

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
<p><strong>Effective Date:</strong> October 12, 2026 &nbsp;&middot;&nbsp; <strong>Version:</strong> 1.2<br/>
<strong>Operator:</strong> Almstins LLC ("Almstins," "we," "us," "our")</p>

<hr/>

<h2>1. Introduction</h2>
<p>This Privacy Policy explains what information Almstins collects, how we use and protect it, and the choices you have, when you use almstins.com and related applications and features (the "Service").</p>

<p><strong>Core principle — tenant isolation.</strong> Almstins operates under strict tenant isolation. Your data belongs to you and is segregated from every other user. Our admin tools show only what we need to run the Service: each account's email, its sign-up and last sign-in dates, and how many wallets, exchange accounts, and imports it has, plus a 30-day log of counts from syncs, imports, and automatic sorting (for example, how many transactions were classified, set aside as dust, or still need review). We read the support messages you send us, and we are emailed when an account is created or subscribes. Our admin tools do not show your transactions, wallet addresses, or documents. Your data is never used for any purpose other than those listed in Section 4.</p>

<h2>2. Our Privacy Architecture (Binding Guarantees)</h2>
<p>These are architectural commitments that shape every section below:</p>

<ul>
  <li><strong>No attribution.</strong> We never link a blockchain address to a person's identity. We do not perform KYC, identity verification, address clustering, or de-anonymization, and we do not build any directory that links addresses to people. Apart from labels in your own account, which only you see, the only names we show next to an address come from our own curated list of well-known contracts and exchanges; from public records published for the address, such as an ENS name or a contract name published with verified source code on Etherscan; or from an organization that proved it controls the address and chose to publish it (Section 5).</li>
  <li><strong>Tenant isolation.</strong> Every record is scoped to your account. No user, and no white-label operator, can access another tenant's data. The exceptions are records you choose to share, such as Verify Destinations you prove, which answer public checks as described in Section 5; receivables records, which anyone holding a receivable's ID can view (Section 3.1); and evidence you upload through an attestation link, which the people who sent you that link can see (Section 3.1).</li>
  <li><strong>No surveillance.</strong> We do not track your off-platform behavior and do not proactively monitor third-party blockchain addresses. You provide the addresses and records you want organized.</li>
  <li><strong>Read-only, no custody.</strong> We never hold keys or move funds, so we never possess the credentials that would make your assets reachable through us.</li>
</ul>

<h2>3. Information We Collect</h2>

<h3>3.1 Information you provide directly</h3>
<ul>
  <li><strong>Account information:</strong> your email; if you sign up with a password, a salted one-way hash of it (never the password itself); your sign-up and last sign-in dates; an optional separate email for alerts; and your subscription tier. If you sign in with Google or GitHub, we also keep the account number that provider uses to identify you (Section 10). <strong>We do not ask for your name to create an account:</strong> a name supplied by Google or GitHub is not kept, and email/password signup asks only for an email and a password. A name can still reach us in the ways listed below, for example on a receivables record, on an attestation, or as the sender name on an email you send us. (Stripe may hold a billing name if you subscribe.)</li>
  <li><strong>Cryptocurrency data:</strong> wallet addresses you supply, public on-chain history for those addresses, and transaction records.</li>
  <li><strong>Address labels and notes:</strong> labels and notes you write, including an optional phone number for a counterparty (for example, a Venmo contact). They stay in your account (Section 5).</li>
  <li><strong>Financial data:</strong> exchange CSVs you import, transaction amounts, cost basis, and gains/losses.</li>
  <li><strong>Document attachments:</strong> receipt images, PDFs, and supporting documents you upload.</li>
  <li><strong>Receivables records (if you use the receivables desk):</strong> client and debtor names, invoice details, payment instructions, contract files you attach, and the email addresses of people you ask to confirm. Anyone who has a receivable's ID can view that record without an account, including names, amounts, payment instructions, claims against it, and confirmations, but not the attached files. The ID is computed from the record's details, so anyone who knows those details exactly can compute it too. The people you ask to confirm can also open the files you attach.</li>
  <li><strong>Evidence you upload through an attestation link someone sends you:</strong> your answer, the name you type, any notes, the files and photos you upload, a signature you draw, and, if you allow your browser to share it, your device's location at the moment you take a photo. A photo or file also keeps any details stored inside it, such as where and when a photo was taken, if your camera recorded them. The people who sent you the link can see all of it.</li>
  <li><strong>Community Content:</strong> we do not currently offer fraud flags or reviews, and nothing is collected through them. Claims of an address are made through Almstins Verify (Section 5). See Section 6.</li>
  <li><strong>Communications:</strong> support tickets, feedback, error reports, and emails you send us, which we keep with the sender name your email shows.</li>
</ul>

<h3>3.2 Information collected automatically</h3>
<ul>
  <li><strong>Usage data:</strong> pages visited, features used, session duration.</li>
  <li><strong>Device information:</strong> browser type, operating system, and IP address (the latter also used for sanctions/geo controls).</li>
  <li><strong>Log data:</strong> timestamps of actions, error logs, API calls.</li>
  <li><strong>Analytics:</strong> Google Analytics records the pages you visit and the actions listed in Section 9 under a cookie ID for your browser. Our own logs of dashboard and sign-in page requests keep the page, your country, and salted one-way hashes of your IP address and browser details. Our logs of checks run on the public checkers keep your country and salted one-way hashes of your IP address and of the address or domain checked. See Sections 9 and 10.</li>
</ul>

<h3>3.3 Information we do NOT collect</h3>
<ul>
  <li>Private keys or seed phrases (we never request these).</li>
  <li>API keys or passwords for your exchange accounts (data is imported via CSV, via screenshots you upload, or read by public address).</li>
  <li>Biometric identifiers or government IDs.</li>
  <li>Identity-linking data — we do not perform KYC.</li>
  <li>Card numbers, or the login details for your own bank. We never ask for them, and card data for billing is handled solely by Stripe. The receivables desk has an optional payment-instructions field: what you enter there, which may include bank account details, is stored with that record and shown to anyone holding its ID (Section 3.1). If a screenshot or receipt you upload shows an account or card number, it is part of that image: we store images you save to your account (Section 3.1), and we send Anthropic the screenshots you ask us to read and the receipt images you attach on a paid plan (Section 8).</li>
</ul>

<h2>4. How We Use Information</h2>
<p>We use information only to:</p>
<ul>
  <li>Provide the Service to you (e.g., compute cost basis, render your dashboard, generate reports, run safety checks you request).</li>
  <li>Authenticate your account and prevent unauthorized access, fraud, and abuse.</li>
  <li>Check links and wallet addresses that appear in email sent to or from our own inboxes against phishing, sanctions, and mixer lists we hold ourselves. Nothing from those messages is sent to an outside service for this.</li>
  <li>Answer public checks on Verify Destinations you have proven (Section 5), and show a receivables record to anyone holding its ID (Section 3.1).</li>
  <li>Send you a short series of getting-started emails after you sign up, and a series about Almstins Verify after you register your first Verify Destination. They describe features, including our paid plans. Accounts that use only our financing desks do not get the first series. Each email has an unsubscribe link that stops the rest of that series.</li>
  <li>Operate community safety features, if offered, in anonymized, aggregated form (Section 6).</li>
  <li>Respond to your support requests.</li>
  <li>Improve the Service through analytics (Sections 3.2 and 9).</li>
  <li>Comply with legal obligations and valid legal process.</li>
</ul>

<p><strong>We never</strong> use your information for advertising (including targeted advertising), profiling, model training, or sale, and we never share it with third parties for their own commercial purposes.</p>

<h2>5. Blockchain Address Handling</h2>
<ul>
  <li><strong>What we collect:</strong> addresses you enter, addresses extracted from your imported CSVs, and addresses observed in public on-chain data for wallets you add. Counterparty addresses may be auto-added to your private address book to help you organize transactions.</li>
  <li><strong>Labels stay in your account.</strong> A label you save (e.g., "Joe's Coffee"), and any phone number you add to it, lives only in your account and is never published or shared with other accounts. Labels you give Verify Destinations are not shown publicly either, with the one exception described below. Separately, the Service shows names for well-known contracts and exchanges from a list we curate ourselves, and public ENS and Etherscan contract names.</li>
  <li><strong>No attribution.</strong> We never associate an address with a person or build a public address-to-identity map. Where you use your own records to evidence your own ownership, that is your voluntary self-disclosure — not something we perform on you or others.</li>
  <li><strong>Retention/deletion:</strong> addresses are retained while needed to provide the Service and per legal retention requirements; you may delete them subject to Section 11.</li>
  <li><strong>Almstins Verify — registered Destinations:</strong> if you use Almstins Verify, we store the payment Destinations you register (receiving addresses, QR codes, or links), any label you give them, and the <strong>proof that you control them</strong>. You prove control with a small payment you send from the address back to itself, which we read on-chain; with a file or DNS record you publish on your own domain, which can include an encrypted list of your addresses; or, for a payment link, by registering it from an account that has already proven its domain. We never ask you to connect a wallet, sign a message, or give us keys. For a PIX or UPI payment QR, we also keep the payee or merchant name it contains, which is shown only to you. We use this data to monitor those Destinations, alert you to changes, answer public checks once a Destination is proven, and start the Verify getting-started emails (Section 4). Camera-based QR scans (Section 7) are <strong>decoded on-device</strong>: we receive only the decoded destination string, never the image. We do <strong>not</strong> link your Destinations to your customers and do <strong>not</strong> monitor third parties.</li>
  <li><strong>What a public check shows:</strong> once you prove a Destination, anyone who enters that address or link in our checkers, or asks our public lookup, can see that it is <strong>Claimed</strong> or <strong>Verified</strong>, since what date, and its blockchain or payment rail. For a Verified Destination, the answer also shows the domain that published it and, if your account has a verified business name, that name and the domain it comes from. A label you typed is never shown publicly, except a label that matches the name of a domain you have proven (for example, Acme for acme.com), which becomes your verified business name. A Destination you have not proven is never shown at all. Your email, your account, and your proof artifacts are never shown to anyone. This is your voluntary disclosure of your own Destination; it is not attribution of any third party, and we still perform no KYC and build no directory that links addresses to people.</li>
  <li><strong>Almstins Verified Entity — public address verification (B.8):</strong> if you operate a Verified Entity (an exchange, business, institution, or other organization), you may register a domain you control and publish, on that domain, the receiving addresses you represent as your own. Here, <strong>by design and at your choice, the verified addresses and the domain that published them are shown publicly</strong> — so anyone can check an address before paying it. This is your organization's <strong>voluntary self-disclosure of its own addresses</strong>, not attribution we perform. We confirm control by <strong>Domain Attestation</strong> (an Almstins-issued challenge you place on your own domain). We then read your address list from an endpoint on your domain, using a read-only API key you give us, which we store encrypted, and we <strong>cache and mirror</strong> what your domain publishes; your published record is the source of truth. <strong>Your account identity (email), the proof artifacts, and the link between your account and your domain stay private and tenant-isolated</strong>, never displayed. We still <strong>never</strong> link a <strong>third party's</strong> address to an identity, perform no KYC, and build no public or cross-tenant address-to-identity directory for anyone who has not themselves proven control. We do not use public verification lookups to profile who is checking. You can revoke an address at any time by removing it from your published record. Applies where and when this Surface is offered.</li>
</ul>

<h2>6. Community Safety Features (Flags, Reviews, Claims, Badges)</h2>
<p><em>Applies when and where these features are offered.</em></p>
<ul>
  <li><strong>Current status:</strong> we do not currently offer fraud flags or reviews, and nothing is collected through them. If we offer them, the rules in this section apply.</li>
  <li><strong>What is stored:</strong> the fraud flag or structured review, keyed to a blockchain <strong>address</strong>, not to a person.</li>
  <li><strong>Reviews</strong> are predefined selections only (no free text, no star ratings); only <strong>aggregate counts</strong> are displayed, never an individual review or reviewer identity.</li>
  <li><strong>Reporter/claimant identity</strong> is stored solely for abuse-prevention and rate-limiting and is <strong>never displayed</strong> or linked to a person publicly or to other tenants.</li>
  <li><strong>Validation:</strong> surfaced fraud signals are gated by an independent third party (e.g., GoPlus); we do not publish a user headcount.</li>
  <li><strong>Claims and control proof:</strong> the only way to claim an address today is Almstins Verify. You prove control as described in Section 5, for example with a small payment you send from the address back to itself. <strong>We never ask you to connect a wallet, sign a message, or provide keys.</strong> A proven claim is publicly checkable as described in Section 5.</li>
  <li><strong>Badges:</strong> when someone checks a proven Verify Destination, our checkers can show a Claimed or Verified badge with the details listed in Section 5, and nothing more.</li>
  <li><strong>Corrections</strong> are handled by re-validation against the independent source, not by disclosing who contributed a signal.</li>
</ul>

<h2>7. Merchant Verification &amp; Camera Features</h2>
<p><em>Applies wherever the Service uses your camera: the wallet checker, Almstins Verify, and attestation links.</em></p>
<ul>
  <li><strong>One-time QR scans</strong> are decoded <strong>on your device</strong>; the image is never stored or sent. The camera runs only while the scanner is open and stops at the first code it reads. A scanned wallet address is checked right away. On the wallet checker, a scanned link is placed in the box and is not checked until you press the check button. On the Verify scan page, and when you check a sign from your Verify dashboard, a scanned link is checked right away. A check sends what was scanned to our servers, and an address or web link also goes to the screening services in Section 10.</li>
  <li><strong>Evidence photos:</strong> an attestation link someone sends you can open your camera so you can photograph work as evidence. Those photos are uploaded and stored, as described in Section 3.1.</li>
  <li><strong>No always-on camera.</strong> Almstins has no continuous or always-on camera feature.</li>
</ul>

<h2>8. AI Features</h2>
<p>Some features send data to our AI provider, <strong>Anthropic (Claude)</strong>, in the cases below:</p>
<ul>
  <li><strong>Screenshot reading:</strong> when you use "Scan Screenshot" (address labels), "Import Screenshot", or "Parse &amp; import" (screenshots you saved on the Transactions page), the whole image is sent so Claude can read the wallet address or transaction in it. Anything visible in it, such as names, amounts, and account details, is sent too, so crop out anything you would rather not share. Unlike camera QR scans (Sections 5 and 7), which are decoded on your device, these images leave your device.</li>
  <li><strong>Transaction triage</strong> (paid plans): for each unresolved transaction, its direction, asset, amount, USD value, type, description, source, date, and your own notes and category.</li>
  <li><strong>Receipt validation</strong> (paid plans): whenever you attach a receipt image to a transaction on the Research page, the image is sent automatically so it can be compared with that transaction. There is no separate step. PDFs are not sent.</li>
</ul>
<p>Outputs are not authoritative. Addresses read from a screenshot are placed in the form for you to check before you save them. A transaction read from a screenshot is saved to your records right away; check it, and delete that import if it is wrong. Triage fills in a category and a note on transactions it rates as an obvious purchase, income, or own-wallet transfer when they have no category yet, and leaves the rest for you; you can change any of them. Receipt results are suggestions you review.</p>

<h2>9. Cookies &amp; Analytics</h2>
<p>We use a small number of cookies and similar browser storage:</p>
<ul>
  <li><strong>Essential:</strong> your sign-in session and its security checks, and the demo session if you try the demo. The Service does not work without them.</li>
  <li><strong>Preferences:</strong> your language choice, and small settings such as text size or whether you have already seen a page's introduction, kept in your browser.</li>
  <li><strong>Analytics:</strong> <strong>Google Analytics</strong> sets its own cookies to count visits, see which pages are used, and count a few named actions: signing up, signing out, adding a wallet (with the blockchain you chose), running the wallet checker, running the site checker (with its red, yellow, or green result), clicking a sign-up button on the checker page, and using the demo (starting it, leaving it, viewing its pages and year-end summary, or clicking its sign-up button). Our tag turns off Google signals and ad personalization. We also keep a small marker in your browser so we count a new account's sign-up only once. Section 10 says what Google Analytics receives.</li>
</ul>
<p>We do not use cookies for advertising. We do not currently show a cookie consent banner. To opt out of Google Analytics, block cookies for almstins.com in your browser, use a content blocker, or install Google's opt-out browser add-on. The Service works without analytics cookies.</p>

<h2>10. Third-Party Services</h2>
<p>We share the minimum data needed with the service providers below, grouped by purpose. Where it matters, we say what each one receives.</p>
<ul>
  <li><strong>Sign-in:</strong> <strong>Google</strong> and <strong>GitHub</strong>, only if you choose to sign in with them. They share your email address and basic profile (such as your name and photo) with us. We keep your email and the account number the provider uses to identify you, which is how we recognize you the next time you sign in. We do not keep your name, your photo, or the provider's sign-in tokens. They learn that you signed in to Almstins.</li>
  <li><strong>Billing:</strong> <strong>Stripe</strong> receives your email, your plan, and an internal account ID. You enter card details directly with Stripe, a PCI-DSS Level 1 provider; we never see them.</li>
  <li><strong>Hosting and database:</strong> <strong>Render</strong> hosts the Service, our Postgres database, and our server logs. Render serves the site through <strong>Cloudflare</strong>'s network, which sees each request and your IP address.</li>
  <li><strong>Email:</strong> an <strong>email/SMTP</strong> provider (sign-in links, verification, welcome, alert, and account emails, and messages you ask us to send to a counterparty), <strong>Resend</strong> (getting-started emails after you sign up or first register a Verify destination), and the providers that host our own inboxes, including <strong>Google (Gmail)</strong> (support, contact, and reconciliation-help messages, error reports, and notices of new sign-ups and subscriptions). Each receives the recipient's email address and the message.</li>
  <li><strong>Analytics:</strong> <strong>Google Analytics</strong> receives the pages you visit and the page you came from (each without the part of the web address after "?", except campaign tags such as utm_source), the named actions listed in Section 9, a cookie ID, browser details, and your IP address. Our tag turns off Google signals and ad personalization. <strong>IPinfo</strong> receives your IP address, to look up its country; from that lookup we keep only the country, filed under a one-way hash of the IP. Some pages also load fonts, icons, or images directly from <strong>Google Fonts</strong>, Google's icon service, <strong>jsDelivr</strong>, and image hosts, which see your IP address and browser as any website does. From the icons a page requests, those services can tell which exchanges or tokens appear in your account.</li>
  <li><strong>Blockchain data:</strong> <strong>Alchemy, Etherscan, Routescan/Snowtrace</strong> (Avalanche), <strong>Blockstream</strong> (Bitcoin), <strong>litecoinspace.org</strong> (Litecoin), a <strong>Solana</strong> RPC provider, <strong>Mysten Labs</strong> (Sui), the <strong>Rootstock</strong> public node, <strong>Sovryn</strong> and <strong>The Graph</strong> (subgraphs), and the <strong>Aave</strong> API. They receive the public wallet addresses and transaction IDs we need to read, never your account details.</li>
  <li><strong>Prices:</strong> <strong>CoinGecko, DefiLlama</strong>, and <strong>Yahoo Finance</strong> receive the tokens or stock symbols to price and the dates, never your wallet address or account details.</li>
  <li><strong>Safety checks:</strong> <strong>GoPlus Security, honeypot.is, Chainalysis</strong> (its sanctions-screening service), <strong>Chainabuse</strong> (run by TRM Labs), <strong>Google Safe Browsing, VirusTotal</strong>, and <strong>URLScan.io</strong> receive the address or link being checked; we add nothing about you to a check. For a link, GoPlus, Google Safe Browsing, and VirusTotal receive the full link, including anything after the domain, while URLScan.io receives only the domain. We only ask VirusTotal whether it already has results for a link; we never submit a link for it to scan. Avoid checking links that contain private access codes or personal details, including private links someone sent you. Section 13 says more about the services run by chain-analysis firms.</li>
  <li><strong>AI:</strong> <strong>Anthropic</strong> receives what the AI features in Section 8 send, only when you use them.</li>
  <li><strong>Time-stamping:</strong> <strong>OpenTimestamps</strong> calendar servers (run by OpenTimestamps, Eternity Wall, and Catallaxy) receive only a one-way SHA-256 fingerprint, never the record itself. Blockstream supplies the public Bitcoin block data used to check a stamp.</li>
</ul>
<p>We also download public phishing, sanctions, and price lists (for example, from GitHub and CoinPaprika); those requests carry nothing about you. These providers have their own privacy practices; we are not responsible for their handling of data.</p>

<h2>11. Data Retention</h2>
<p>We keep data while your account is open and as long as needed to provide the Service, to comply with legal obligations, and to resolve disputes and enforce our agreements. You can delete your account and data yourself at any time, or ask us at privacy@almstins.com. Deletion removes all of your account's data except records other parties rely on in our financing desks, such as receivables, projects, claims, confirmations, attestations, and their documents, which we keep for those parties under this section. We do not keep your tax records for you after you delete your account, so export what you need first; tax records often need to be kept for 7 years or more. Emails you sent to our inboxes, and billing records Stripe keeps, are not part of your account's data; you can ask us at privacy@almstins.com to delete those emails. Deleted data cannot be recovered from the Service, though it can remain in our database host's backups until they expire.</p>

<h2>12. Security</h2>
<p>We use industry-standard measures, including HTTPS for data in transit; encryption at rest of stored data, provided by our database host; additional AES-256-GCM encryption, applied by us, for Verified Entity API keys and for the saved copy of a roster address list; role-based access control; and breach-response protocols. However, no system is fully secure, and we cannot guarantee absolute protection against all attacks or breaches.</p>

<h2>13. Legal Requests and Law Enforcement</h2>
<p>We may disclose data only when required by valid legal process (such as a subpoena or court order) or to investigate fraud or abuse with proper legal authority. <strong>We do not share data with law enforcement absent valid legal process, and chain-analysis firms receive nothing from us beyond the address checks described below.</strong> Where legally permitted, we will notify you of legal requests for your data. We do not honor informal requests.</p>
<p><strong>Address and link checks.</strong> When you, or anyone using our checkers, asks us to check an address or link, our servers send that address or link to the screening services in Section 10. They include services run by the chain-analysis firms Chainalysis and TRM Labs (which runs Chainabuse). A check carries the address or link (and, for some services, which blockchain it is on) and nothing else about you: not your name, email, account ID, or IP address. These are lookups only: we never submit a link or address for scanning. Addresses and links in email sent to or from our own inboxes are checked only against lists we hold ourselves and are never sent to these services. We do not file scam or fraud reports about anyone, with these services or with anyone else.</p>

<h2>14. International Data Transfers</h2>
<p>Your data may be processed and stored in the United States or other countries. By using the Service, you consent to such transfer and processing, subject to applicable data-protection law.</p>

<h2>15. Children's Privacy</h2>
<p>The Service is intended for users 18 and older. We do not knowingly collect data from minors and will delete such data if discovered.</p>

<h2>16. Your Rights</h2>
<p>Subject to applicable law (including GDPR and CCPA), you may:</p>
<ul>
  <li><strong>Access</strong> a copy of the data we hold about you;</li>
  <li><strong>Correct</strong> inaccurate data;</li>
  <li><strong>Delete</strong> your account and data (except records other parties rely on in our financing desks, as described in Section 11, and subject to legal holds);</li>
  <li><strong>Opt out</strong> of analytics and optional features;</li>
  <li><strong>Port</strong> your data via export in a standard format.</li>
</ul>
<p>We do not sell personal information and do not "share" it for cross-context behavioral advertising. To exercise any right, contact <strong>privacy@almstins.com</strong>.</p>

<h2>17. Changes to This Policy</h2>
<p>We may update this Policy. Material changes will be notified by email or in-product notice; continued use after the effective date constitutes acceptance.</p>

<h2>18. Contact</h2>
<p>Privacy Officer — Almstins LLC — <strong>privacy@almstins.com</strong></p>
`,
};

export const es: PrivacyLocale = {
  lang: 'es',
  summaryLabel: 'Política de Privacidad',
  ariaLabel: 'Política de Privacidad',
  body: `
<h1>POLÍTICA DE PRIVACIDAD DE ALMSTINS</h1>
<p><strong>Fecha de Vigencia:</strong> 12 de octubre de 2026 &nbsp;&middot;&nbsp; <strong>Versión:</strong> 1.2<br/>
<strong>Operador:</strong> Almstins LLC ("Almstins," "nosotros," "nos," "nuestro")</p>

<hr/>

<h2>1. Introducción</h2>
<p>Esta Política de Privacidad explica qué información recopila Almstins, cómo la utilizamos y protegemos, y las opciones que usted tiene al usar almstins.com y las aplicaciones y funciones relacionadas (el "Servicio").</p>

<p><strong>Principio fundamental — aislamiento de inquilinos.</strong> Almstins opera bajo un estricto aislamiento de inquilinos. Sus datos le pertenecen a usted y están segregados de los de cualquier otro usuario. Nuestras herramientas de administración muestran solo lo que necesitamos para operar el Servicio: el correo electrónico de cada cuenta, sus fechas de alta y de último inicio de sesión, y cuántas wallets, cuentas de exchange e importaciones tiene, además de un registro de 30 días con recuentos de sincronizaciones, importaciones y clasificación automática (por ejemplo, cuántas transacciones se clasificaron, se apartaron como polvo o aún necesitan revisión). Leemos los mensajes de soporte que usted nos envía, y recibimos un correo electrónico cuando se crea una cuenta o cuando una cuenta se suscribe. Nuestras herramientas de administración no muestran sus transacciones, sus direcciones de wallet ni sus documentos. Sus datos nunca se utilizan para ningún propósito distinto de los indicados en la Sección 4.</p>

<h2>2. Nuestra Arquitectura de Privacidad (Garantías Vinculantes)</h2>
<p>Estos son compromisos arquitectónicos que fundamentan cada sección a continuación:</p>

<ul>
  <li><strong>Sin atribución.</strong> Nunca vinculamos una dirección de blockchain con la identidad de una persona. No realizamos KYC, verificación de identidad, agrupación de direcciones ni desanonimización, y no construimos ningún directorio que vincule direcciones con personas. Aparte de las etiquetas de su propia cuenta, que solo usted ve, los únicos nombres que mostramos junto a una dirección provienen de nuestra propia lista seleccionada de contratos y exchanges conocidos; de registros públicos publicados para la dirección, como un nombre ENS o el nombre de un contrato publicado con su código fuente verificado en Etherscan; o de una organización que demostró que controla la dirección y eligió publicarla (Sección 5).</li>
  <li><strong>Aislamiento de inquilinos.</strong> Cada registro está limitado a su cuenta. Ningún usuario, ni ningún operador de marca blanca, puede acceder a los datos de otro inquilino. Las excepciones son los registros que usted elige compartir, como los Destinos de Verify que usted demuestra, que responden a las consultas públicas según se describe en la Sección 5; los registros de cuentas por cobrar, que cualquier persona que tenga el ID de una cuenta por cobrar puede ver (Sección 3.1); y las pruebas que usted sube mediante un enlace de atestación, que pueden ver las personas que le enviaron ese enlace (Sección 3.1).</li>
  <li><strong>Sin vigilancia.</strong> No rastreamos su comportamiento fuera de la plataforma ni monitoreamos proactivamente direcciones de blockchain de terceros. Usted proporciona las direcciones y los registros que desea organizar.</li>
  <li><strong>Solo lectura, sin custodia.</strong> Nunca custodiamos claves ni movemos fondos, por lo que nunca poseemos las credenciales que harían que sus activos fueran accesibles a través de nosotros.</li>
</ul>

<h2>3. Información que Recopilamos</h2>

<h3>3.1 Información que usted proporciona directamente</h3>
<ul>
  <li><strong>Información de cuenta:</strong> su correo electrónico; si se registra con contraseña, un hash unidireccional con sal de esa contraseña (nunca la contraseña en sí); sus fechas de alta y de último inicio de sesión; un correo electrónico opcional distinto para las alertas; y su nivel de suscripción. Si inicia sesión con Google o GitHub, también conservamos el número de cuenta con el que ese proveedor le identifica (Sección 10). <strong>No le pedimos su nombre para crear una cuenta:</strong> no conservamos el nombre que proporcionan Google o GitHub, y el registro por correo electrónico y contraseña solicita únicamente un correo electrónico y una contraseña. Aun así, un nombre puede llegarnos por las vías que se indican a continuación, por ejemplo en un registro de cuentas por cobrar, en una atestación o como nombre del remitente de un correo que usted nos envía. (Stripe puede conservar un nombre de facturación si usted se suscribe.)</li>
  <li><strong>Datos de criptomonedas:</strong> direcciones de wallet que usted suministra, historial público en cadena de esas direcciones y registros de transacciones.</li>
  <li><strong>Etiquetas y notas de direcciones:</strong> las etiquetas y notas que usted escribe, incluido un número de teléfono opcional de una contraparte (por ejemplo, un contacto de Venmo). Permanecen en su cuenta (Sección 5).</li>
  <li><strong>Datos financieros:</strong> archivos CSV de exchanges que usted importa, montos de transacciones, base de costo y ganancias/pérdidas.</li>
  <li><strong>Archivos adjuntos de documentos:</strong> imágenes de recibos, PDFs y documentos de respaldo que usted sube.</li>
  <li><strong>Registros de cuentas por cobrar (si usa la mesa de cuentas por cobrar):</strong> nombres de clientes y deudores, datos de facturas, instrucciones de pago, archivos de contratos que usted adjunta y las direcciones de correo electrónico de las personas a quienes pide confirmar. Cualquier persona que tenga el ID de una cuenta por cobrar puede ver ese registro sin una cuenta, incluidos los nombres, los montos, las instrucciones de pago, las reclamaciones registradas sobre ella y las confirmaciones, pero no los archivos adjuntos. El ID se calcula a partir de los datos del registro, por lo que cualquier persona que conozca esos datos con exactitud también puede calcularlo. Las personas a quienes pide confirmar también pueden abrir los archivos que usted adjunta.</li>
  <li><strong>Pruebas que usted sube mediante un enlace de atestación que alguien le envía:</strong> su respuesta, el nombre que escribe, sus notas, los archivos y fotos que sube, una firma que dibuja y, si permite que su navegador la comparta, la ubicación de su dispositivo en el momento en que toma una foto. Una foto o un archivo también conserva los datos que lleve incluidos, como dónde y cuándo se tomó una foto, si su cámara los registró. Las personas que le enviaron el enlace pueden ver todo ello.</li>
  <li><strong>Contenido Comunitario:</strong> actualmente no ofrecemos marcadores de fraude ni reseñas, y no se recopila nada a través de ellos. Las reclamaciones de direcciones se hacen mediante Almstins Verify (Sección 5). Véase la Sección 6.</li>
  <li><strong>Comunicaciones:</strong> tickets de soporte, comentarios, informes de errores y los correos que usted nos envía, que conservamos con el nombre de remitente que muestra su correo.</li>
</ul>

<h3>3.2 Información recopilada automáticamente</h3>
<ul>
  <li><strong>Datos de uso:</strong> páginas visitadas, funciones utilizadas, duración de la sesión.</li>
  <li><strong>Información del dispositivo:</strong> tipo de navegador, sistema operativo y dirección IP (esta última también se utiliza para controles de sanciones y geolocalización).</li>
  <li><strong>Datos de registro:</strong> marcas de tiempo de acciones, registros de errores, llamadas a la API.</li>
  <li><strong>Analíticas:</strong> Google Analytics registra las páginas que visita y las acciones indicadas en la Sección 9 bajo un identificador de cookie de su navegador. Nuestros propios registros de las solicitudes a las páginas del panel y de inicio de sesión conservan la página, su país y hashes unidireccionales con sal de su dirección IP y de los datos de su navegador. Nuestros registros de las verificaciones realizadas en los verificadores públicos conservan su país y hashes unidireccionales con sal de su dirección IP y de la dirección o el dominio verificado. Véanse las Secciones 9 y 10.</li>
</ul>

<h3>3.3 Información que NO recopilamos</h3>
<ul>
  <li>Claves privadas ni seed phrases (nunca las solicitamos).</li>
  <li>Claves API ni contraseñas de sus cuentas de exchange (los datos se importan mediante CSV o mediante capturas de pantalla que usted sube, o se leen por dirección pública).</li>
  <li>Identificadores biométricos ni documentos de identidad gubernamentales.</li>
  <li>Datos de vinculación de identidad — no realizamos KYC.</li>
  <li>Números de tarjetas ni los datos de acceso a su propio banco. Nunca los solicitamos, y los datos de tarjetas para la facturación son gestionados exclusivamente por Stripe. La mesa de cuentas por cobrar tiene un campo opcional de instrucciones de pago: lo que usted escriba allí, que puede incluir datos de una cuenta bancaria, se guarda con ese registro y se muestra a cualquier persona que tenga su ID (Sección 3.1). Si una captura de pantalla o un recibo que usted sube muestra un número de cuenta o de tarjeta, forma parte de esa imagen: conservamos las imágenes que usted guarda en su cuenta (Sección 3.1) y enviamos a Anthropic las capturas que usted nos pide leer y las imágenes de recibos que adjunta con un plan de pago (Sección 8).</li>
</ul>

<h2>4. Cómo Utilizamos la Información</h2>
<p>Utilizamos la información únicamente para:</p>
<ul>
  <li>Prestarle el Servicio (p. ej., calcular la base de costo, mostrar su panel de control, generar informes, ejecutar verificaciones de seguridad que usted solicite).</li>
  <li>Autenticar su cuenta y prevenir el acceso no autorizado, el fraude y el abuso.</li>
  <li>Comprobar los enlaces y las direcciones de wallet que aparecen en los correos enviados a nuestros propios buzones o desde ellos, contrastándolos con listas de phishing, de sanciones y de mezcladores (mixers) que conservamos nosotros mismos. Para ello, nada de esos mensajes se envía a un servicio externo.</li>
  <li>Responder a las consultas públicas sobre los Destinos de Verify que usted ha demostrado (Sección 5) y mostrar un registro de cuentas por cobrar a cualquier persona que tenga su ID (Sección 3.1).</li>
  <li>Enviarle una breve serie de correos de introducción después de registrarse, y una serie sobre Almstins Verify después de registrar su primer Destino en Verify. Describen funciones, incluidos nuestros planes de pago. Las cuentas que solo usan nuestras mesas de financiación no reciben la primera serie. Cada correo incluye un enlace para darse de baja que detiene el resto de esa serie.</li>
  <li>Operar las funciones de seguridad comunitaria, si se ofrecen, de forma anónima y agregada (Sección 6).</li>
  <li>Responder a sus solicitudes de soporte.</li>
  <li>Mejorar el Servicio mediante analíticas (Secciones 3.2 y 9).</li>
  <li>Cumplir con las obligaciones legales y los procesos legales válidos.</li>
</ul>

<p><strong>Nunca</strong> utilizamos su información para publicidad (incluida la publicidad dirigida), elaboración de perfiles, entrenamiento de modelos o venta, y nunca la compartimos con terceros para sus propios fines comerciales.</p>

<h2>5. Manejo de Direcciones de Blockchain</h2>
<ul>
  <li><strong>Qué recopilamos:</strong> las direcciones que usted ingresa, las direcciones extraídas de los CSVs que importa, y las direcciones observadas en los datos públicos en cadena de las wallets que agrega. Las direcciones de contrapartes pueden añadirse automáticamente a su libreta de direcciones privada para ayudarle a organizar las transacciones.</li>
  <li><strong>Las etiquetas permanecen en su cuenta.</strong> Una etiqueta que usted guarda (p. ej., "Café de Juan"), y cualquier número de teléfono que le añada, reside únicamente en su cuenta y nunca se publica ni se comparte con otras cuentas. Las etiquetas que usted asigna a los Destinos de Verify tampoco se muestran públicamente, con la única excepción que se describe más abajo. Por otra parte, el Servicio muestra nombres de contratos y exchanges conocidos a partir de una lista que seleccionamos nosotros mismos, y nombres públicos de ENS y de contratos de Etherscan.</li>
  <li><strong>Sin atribución.</strong> Nunca asociamos una dirección con una persona ni construimos un mapa público de dirección-a-identidad. Cuando usted utiliza sus propios registros para acreditar su propia titularidad, eso constituye una divulgación voluntaria de su parte — no algo que realizamos sobre usted ni sobre terceros.</li>
  <li><strong>Retención/eliminación:</strong> las direcciones se conservan mientras sean necesarias para prestar el Servicio y de conformidad con los requisitos legales de retención; usted puede eliminarlas conforme a la Sección 11.</li>
  <li><strong>Almstins Verify — Destinos registrados:</strong> si usa Almstins Verify, almacenamos los Destinos de pago que usted registra (direcciones de recepción, códigos QR o enlaces), cualquier etiqueta que les asigne y la <strong>prueba de que usted los controla</strong>. Usted demuestra el control con un pequeño pago que envía desde la dirección a sí misma, que leemos en la cadena; con un archivo o un registro DNS que publica en su propio dominio, que puede incluir una lista cifrada de sus direcciones; o, en el caso de un enlace de pago, registrándolo desde una cuenta que ya haya demostrado su dominio. Nunca le pedimos que conecte una wallet, que firme un mensaje ni que nos dé claves. En el caso de un QR de pago PIX o UPI, también conservamos el nombre del beneficiario o del comercio que contiene, que solo se le muestra a usted. Utilizamos estos datos para supervisar esos Destinos, alertarle de cambios, responder a las consultas públicas una vez demostrado un Destino e iniciar los correos de introducción de Verify (Sección 4). Los escaneos de QR mediante cámara (Sección 7) se <strong>decodifican en el dispositivo</strong>: recibimos únicamente la cadena de destino decodificada, nunca la imagen. <strong>No</strong> vinculamos sus Destinos con sus clientes y <strong>no</strong> supervisamos a terceros.</li>
  <li><strong>Qué muestra una consulta pública:</strong> una vez que usted demuestra un Destino, cualquier persona que introduzca esa dirección o ese enlace en nuestros verificadores, o que use nuestra consulta pública, puede ver que está <strong>Reclamado</strong> (Claimed) o <strong>Verificado</strong> (Verified), desde qué fecha, y su blockchain o red de pago. En el caso de un Destino Verificado, la respuesta también muestra el dominio que lo publicó y, si su cuenta tiene un nombre comercial verificado, ese nombre y el dominio del que proviene. Una etiqueta que usted escribió nunca se muestra públicamente, salvo una etiqueta que coincide con el nombre de un dominio que usted ha demostrado (por ejemplo, Acme para acme.com), que se convierte en su nombre comercial verificado. Un Destino que usted no ha demostrado nunca se muestra. Su correo electrónico, su cuenta y sus artefactos de prueba nunca se muestran a nadie. Esto es su divulgación voluntaria de su propio Destino; no es atribución de ningún tercero, y seguimos sin realizar KYC y sin construir ningún directorio que vincule direcciones con personas.</li>
  <li><strong>Almstins Verified Entity — verificación pública de direcciones (B.8):</strong> si opera una Verified Entity (un exchange, negocio, institución u otra organización), puede registrar un dominio que controla y publicar, en ese dominio, las direcciones de recepción que declara como propias. Aquí, <strong>por diseño y por su elección, las direcciones verificadas y el dominio que las publicó se muestran públicamente</strong> — para que cualquiera pueda comprobar una dirección antes de pagarla. Esto es la <strong>autodivulgación voluntaria de su organización sobre sus propias direcciones</strong>, no una atribución que nosotros realicemos. Confirmamos el control mediante <strong>Domain Attestation</strong> (un desafío emitido por Almstins que usted coloca en su propio dominio). Luego leemos su lista de direcciones desde un endpoint de su dominio, usando una clave API de solo lectura que usted nos da y que almacenamos cifrada, y <strong>almacenamos en caché y reflejamos</strong> lo que su dominio publica; su registro publicado es la fuente de verdad. <strong>La identidad de su cuenta (correo electrónico), los artefactos de prueba y el vínculo entre su cuenta y su dominio permanecen privados y bajo aislamiento de inquilinos</strong>, nunca se muestran. Seguimos sin vincular <strong>nunca</strong> la dirección de un <strong>tercero</strong> con una identidad, sin realizar KYC y sin construir ningún directorio público o entre inquilinos de dirección-a-identidad para quien no haya demostrado el control por sí mismo. No usamos las consultas públicas de verificación para perfilar a quién consulta. Puede revocar una dirección en cualquier momento eliminándola de su registro publicado. Se aplica cuando y donde se ofrezca esta Superficie.</li>
</ul>

<h2>6. Funciones de Seguridad Comunitaria (Marcadores, Reseñas, Reclamaciones, Insignias)</h2>
<p><em>Aplicable cuando y donde estas funciones estén disponibles.</em></p>
<ul>
  <li><strong>Situación actual:</strong> actualmente no ofrecemos marcadores de fraude ni reseñas, y no se recopila nada a través de ellos. Si los ofrecemos, se aplicarán las reglas de esta sección.</li>
  <li><strong>Qué se almacena:</strong> el marcador de fraude o la reseña estructurada, vinculados a una <strong>dirección</strong> de blockchain, no a una persona.</li>
  <li><strong>Las reseñas</strong> son únicamente selecciones predefinidas (sin texto libre ni calificaciones por estrellas); solo se muestran <strong>totales agregados</strong>, nunca una reseña individual ni la identidad del evaluador.</li>
  <li><strong>La identidad del denunciante/reclamante</strong> se almacena exclusivamente para la prevención de abusos y la limitación de frecuencia, y <strong>nunca se muestra</strong> ni se vincula a una persona de manera pública o ante otros inquilinos.</li>
  <li><strong>Validación:</strong> las señales de fraude publicadas son filtradas por un tercero independiente (p. ej., GoPlus); no publicamos el número de usuarios.</li>
  <li><strong>Reclamaciones y prueba de control:</strong> hoy la única forma de reclamar una dirección es Almstins Verify. Usted demuestra el control según se describe en la Sección 5, por ejemplo con un pequeño pago que envía desde la dirección a sí misma. <strong>Nunca le pedimos que conecte una wallet, que firme un mensaje ni que proporcione claves.</strong> Una reclamación demostrada puede consultarse públicamente según se describe en la Sección 5.</li>
  <li><strong>Insignias:</strong> cuando alguien consulta un Destino de Verify demostrado, nuestros verificadores pueden mostrar una insignia de Reclamado o Verificado con los datos indicados en la Sección 5, y nada más.</li>
  <li><strong>Correcciones</strong> se gestionan mediante la revalidación con la fuente independiente, sin revelar quién contribuyó una señal.</li>
</ul>

<h2>7. Verificación de Comerciantes y Funciones de Cámara</h2>
<p><em>Se aplica dondequiera que el Servicio use su cámara: el verificador de wallets, Almstins Verify y los enlaces de atestación.</em></p>
<ul>
  <li><strong>Los escaneos puntuales de QR</strong> se decodifican <strong>en su dispositivo</strong>; la imagen nunca se almacena ni se envía. La cámara funciona solo mientras el escáner está abierto y se detiene en el primer código que lee. Una dirección de wallet escaneada se verifica de inmediato. En el verificador de wallets, un enlace escaneado se coloca en el cuadro y no se verifica hasta que usted pulsa el botón de verificar. En la página de escaneo de Verify, y cuando usted comprueba un letrero desde su panel de Verify, un enlace escaneado se verifica de inmediato. Una verificación envía lo escaneado a nuestros servidores, y una dirección o un enlace web también se envía a los servicios de verificación de la Sección 10.</li>
  <li><strong>Fotos de prueba:</strong> un enlace de atestación que alguien le envía puede abrir su cámara para que usted fotografíe un trabajo como prueba. Esas fotos se suben y se almacenan, según se describe en la Sección 3.1.</li>
  <li><strong>Sin cámara permanente.</strong> Almstins no tiene ninguna función de cámara continua o permanente.</li>
</ul>

<h2>8. Funciones de IA</h2>
<p>Algunas funciones envían datos a nuestro proveedor de IA, <strong>Anthropic (Claude)</strong>, en los casos siguientes:</p>
<ul>
  <li><strong>Lectura de capturas de pantalla:</strong> cuando usted usa "Escanear captura" (etiquetas de direcciones), "Importar captura" o "Analizar e importar" (capturas guardadas en la página de Transacciones), se envía la imagen completa para que Claude lea la dirección de wallet o la transacción que contiene. Todo lo que aparezca en ella, como nombres, montos y datos de cuentas, también se envía, por lo que le recomendamos recortar la imagen para excluir lo que prefiera no compartir. A diferencia de los escaneos de QR con la cámara (Secciones 5 y 7), que se decodifican en su dispositivo, estas imágenes salen de su dispositivo.</li>
  <li><strong>Clasificación de transacciones</strong> (planes de pago): para cada transacción sin resolver, su sentido (entrada o salida), activo, monto, valor en USD, tipo, descripción, origen, fecha, y sus propias notas y categoría.</li>
  <li><strong>Validación de recibos</strong> (planes de pago): cada vez que usted adjunta la imagen de un recibo a una transacción en la página de Investigación, la imagen se envía automáticamente para compararla con esa transacción. No hay un paso aparte. Los PDFs no se envían.</li>
</ul>
<p>Los resultados no son vinculantes. Las direcciones leídas en una captura se colocan en el formulario para que usted las revise antes de guardarlas. Una transacción leída en una captura se guarda de inmediato en sus registros; revísela y elimine esa importación si es incorrecta. La clasificación asigna una categoría y una nota a las transacciones que considera claramente una compra, un ingreso o una transferencia entre sus propias wallets, cuando aún no tienen categoría, y deja el resto para usted; usted puede cambiar cualquiera de ellas. Los resultados de la validación de recibos son sugerencias que usted revisa.</p>

<h2>9. Cookies y Analytics</h2>
<p>Utilizamos un pequeño número de cookies y de elementos similares de almacenamiento en el navegador:</p>
<ul>
  <li><strong>Esenciales:</strong> su sesión iniciada y sus comprobaciones de seguridad, y la sesión de demostración si prueba la demo. El Servicio no funciona sin ellas.</li>
  <li><strong>Preferencias:</strong> el idioma que elige y pequeños ajustes, como el tamaño del texto o si ya vio la introducción de una página, guardados en su navegador.</li>
  <li><strong>Analíticas:</strong> <strong>Google Analytics</strong> instala sus propias cookies para contar las visitas, ver qué páginas se usan y contar algunas acciones con nombre: registrarse, cerrar sesión, agregar una wallet (con la blockchain que eligió), usar el verificador de wallets, usar el verificador de sitios (con su resultado rojo, amarillo o verde), hacer clic en un botón de registro de la página del verificador y usar la demo (iniciarla, salir de ella, ver sus páginas y su resumen de fin de año, o hacer clic en su botón de registro). Nuestra etiqueta desactiva Google signals y la personalización de anuncios. También guardamos una pequeña marca en su navegador para contar el registro de una cuenta nueva una sola vez. La Sección 10 indica qué recibe Google Analytics.</li>
</ul>
<p>No utilizamos cookies con fines publicitarios. Actualmente no mostramos un aviso de consentimiento de cookies. Para excluirse de Google Analytics, bloquee las cookies de almstins.com en su navegador, use un bloqueador de contenido o instale el complemento de inhabilitación para navegadores de Google. El Servicio funciona sin las cookies de analíticas.</p>

<h2>10. Servicios de Terceros</h2>
<p>Compartimos el mínimo de datos necesario con los proveedores de servicios que se indican a continuación, agrupados por finalidad. Cuando resulta pertinente, indicamos qué recibe cada uno.</p>
<ul>
  <li><strong>Inicio de sesión:</strong> <strong>Google</strong> y <strong>GitHub</strong>, solo si usted elige iniciar sesión con ellos. Nos facilitan su correo electrónico y su perfil básico (como su nombre y su foto). Conservamos su correo electrónico y el número de cuenta con el que el proveedor le identifica, que es como le reconocemos la próxima vez que inicia sesión. No conservamos su nombre, su foto ni los tokens de inicio de sesión del proveedor. Saben que usted inició sesión en Almstins.</li>
  <li><strong>Facturación:</strong> <strong>Stripe</strong> recibe su correo electrónico, su plan y un identificador interno de cuenta. Usted introduce los datos de su tarjeta directamente en Stripe, un proveedor PCI-DSS Level 1; nosotros nunca los vemos.</li>
  <li><strong>Alojamiento y base de datos:</strong> <strong>Render</strong> aloja el Servicio, nuestra base de datos Postgres y nuestros registros (logs) del servidor. Render distribuye el sitio a través de la red de <strong>Cloudflare</strong>, que ve cada solicitud y su dirección IP.</li>
  <li><strong>Correo electrónico:</strong> un proveedor de <strong>correo electrónico/SMTP</strong> (enlaces de inicio de sesión, verificación, correos de bienvenida, de alerta y de cuenta, y los mensajes que usted nos solicita enviar a una contraparte), <strong>Resend</strong> (correos de introducción tras registrarse o registrar su primer destino en Verify) y los proveedores que alojan nuestros propios buzones, incluido <strong>Google (Gmail)</strong> (mensajes de soporte, de contacto y de ayuda con la conciliación, informes de errores y avisos de nuevas altas de usuarios y de suscripciones). Cada uno recibe la dirección de correo electrónico del destinatario y el mensaje.</li>
  <li><strong>Analíticas:</strong> <strong>Google Analytics</strong> recibe las páginas que visita y la página de la que viene (cada una sin la parte de la dirección web que sigue a "?", salvo las etiquetas de campaña como utm_source), las acciones con nombre indicadas en la Sección 9, un identificador de cookie, datos de su navegador y su dirección IP. Nuestra etiqueta desactiva Google signals y la personalización de anuncios. <strong>IPinfo</strong> recibe su dirección IP, para determinar su país; de esa consulta solo conservamos el país, archivado bajo un hash unidireccional de la IP. Algunas páginas también cargan fuentes, íconos o imágenes directamente desde <strong>Google Fonts</strong>, el servicio de íconos de Google, <strong>jsDelivr</strong> y servidores de imágenes, que ven su dirección IP y su navegador como cualquier sitio web. Por los íconos que solicita una página, esos servicios pueden saber qué exchanges o tokens aparecen en su cuenta.</li>
  <li><strong>Datos de blockchain:</strong> <strong>Alchemy, Etherscan, Routescan/Snowtrace</strong> (Avalanche), <strong>Blockstream</strong> (Bitcoin), <strong>litecoinspace.org</strong> (Litecoin), un proveedor RPC de <strong>Solana</strong>, <strong>Mysten Labs</strong> (Sui), el nodo público de <strong>Rootstock</strong>, <strong>Sovryn</strong> y <strong>The Graph</strong> (subgraphs), y la API de <strong>Aave</strong>. Reciben las direcciones de wallet públicas y los identificadores de transacción que necesitamos leer, nunca los datos de su cuenta.</li>
  <li><strong>Precios:</strong> <strong>CoinGecko, DefiLlama</strong> y <strong>Yahoo Finance</strong> reciben los tokens o símbolos de acciones que se deben valorar y las fechas, nunca su dirección de wallet ni los datos de su cuenta.</li>
  <li><strong>Verificaciones de seguridad:</strong> <strong>GoPlus Security, honeypot.is, Chainalysis</strong> (el servicio de control de sanciones de esa empresa), <strong>Chainabuse</strong> (operado por TRM Labs), <strong>Google Safe Browsing, VirusTotal</strong> y <strong>URLScan.io</strong> reciben la dirección o el enlace que se verifica; no añadimos nada sobre usted a una verificación. En el caso de un enlace, GoPlus, Google Safe Browsing y VirusTotal reciben el enlace completo, incluido todo lo que sigue al dominio, mientras que URLScan.io recibe solo el dominio. A VirusTotal solo le preguntamos si ya tiene resultados para un enlace; nunca le enviamos un enlace para que lo analice. Evite verificar enlaces que contengan códigos de acceso privados o datos personales, incluidos los enlaces privados que alguien le haya enviado. La Sección 13 amplía la información sobre los servicios operados por empresas de análisis de blockchain.</li>
  <li><strong>IA:</strong> <strong>Anthropic</strong> recibe lo que envían las funciones de IA descritas en la Sección 8, solo cuando usted las utiliza.</li>
  <li><strong>Sellado de tiempo:</strong> los servidores de calendario de <strong>OpenTimestamps</strong> (operados por OpenTimestamps, Eternity Wall y Catallaxy) reciben solo una huella SHA-256 unidireccional, nunca el registro en sí. Blockstream proporciona los datos públicos de bloques de Bitcoin que se usan para comprobar un sello.</li>
</ul>
<p>También descargamos listas públicas de phishing, de sanciones y de precios (por ejemplo, de GitHub y CoinPaprika); esas solicitudes no contienen nada sobre usted. Estos proveedores tienen sus propias prácticas de privacidad; no somos responsables de su manejo de los datos.</p>

<h2>11. Retención de Datos</h2>
<p>Conservamos los datos mientras su cuenta esté abierta y durante el tiempo necesario para prestar el Servicio, cumplir con las obligaciones legales, y resolver disputas y hacer cumplir nuestros acuerdos. Usted puede eliminar su cuenta y sus datos por sí mismo en cualquier momento, o pedírnoslo en privacy@almstins.com. La eliminación borra todos los datos de su cuenta, excepto los registros de los que dependen otras partes en nuestras mesas de financiación, como cuentas por cobrar, proyectos, reclamaciones, confirmaciones, atestaciones y sus documentos, que conservamos para esas partes conforme a esta sección. No conservamos sus registros fiscales por usted después de que elimine su cuenta, así que exporte primero lo que necesite; los registros fiscales a menudo deben conservarse 7 años o más. Los correos que usted envió a nuestros buzones y los registros de facturación que conserva Stripe no forman parte de los datos de su cuenta; puede pedirnos en privacy@almstins.com que eliminemos esos correos. Los datos eliminados no se pueden recuperar desde el Servicio, aunque pueden permanecer en las copias de seguridad de nuestro proveedor de base de datos hasta que caduquen.</p>

<h2>12. Seguridad</h2>
<p>Empleamos medidas estándar del sector, incluidas HTTPS para los datos en tránsito; el cifrado en reposo de los datos almacenados, que aplica nuestro proveedor de base de datos; un cifrado adicional AES-256-GCM, aplicado por nosotros, para las claves API de las Verified Entity y para la copia guardada de una lista de direcciones (roster); el control de acceso basado en roles; y protocolos de respuesta ante brechas. Sin embargo, ningún sistema es completamente seguro, y no podemos garantizar protección absoluta contra todos los ataques o brechas.</p>

<h2>13. Solicitudes Legales y Fuerzas del Orden</h2>
<p>Podemos divulgar datos únicamente cuando lo exija un proceso legal válido (como una citación judicial u orden de un tribunal) o para investigar fraude o abuso con la debida autoridad legal. <strong>No compartimos datos con las fuerzas del orden sin un proceso legal válido, y las empresas de análisis de blockchain no reciben de nosotros nada más que las verificaciones de direcciones descritas a continuación.</strong> En la medida en que lo permita la ley, le notificaremos las solicitudes legales relativas a sus datos. No atendemos solicitudes informales.</p>
<p><strong>Verificaciones de direcciones y enlaces.</strong> Cuando usted, o cualquier persona que utilice nuestros verificadores, nos pide verificar una dirección o un enlace, nuestros servidores envían esa dirección o ese enlace a los servicios de verificación indicados en la Sección 10. Entre ellos hay servicios operados por las empresas de análisis de blockchain Chainalysis y TRM Labs (que opera Chainabuse). Una verificación incluye la dirección o el enlace (y, para algunos servicios, la blockchain a la que pertenece) y nada más sobre usted: ni su nombre, ni su correo electrónico, ni el identificador de su cuenta, ni su dirección IP. Se trata solo de consultas: nunca enviamos un enlace ni una dirección para que se analice. Las direcciones y los enlaces de los correos enviados a nuestros propios buzones o desde ellos se comprueban solo con listas que conservamos nosotros mismos y nunca se envían a estos servicios. No enviamos informes de estafa o fraude sobre nadie, ni a estos servicios ni a ningún otro destinatario.</p>

<h2>14. Transferencias Internacionales de Datos</h2>
<p>Sus datos pueden ser procesados y almacenados en los Estados Unidos u otros países. Al utilizar el Servicio, usted consiente dicha transferencia y procesamiento, sujeto a la legislación aplicable en materia de protección de datos.</p>

<h2>15. Privacidad de Menores</h2>
<p>El Servicio está destinado a usuarios mayores de 18 años. No recopilamos datos de menores de forma consciente y eliminaremos dichos datos si los descubrimos.</p>

<h2>16. Sus Derechos</h2>
<p>Sujeto a la legislación aplicable (incluidos GDPR y CCPA), usted puede:</p>
<ul>
  <li><strong>Acceder</strong> a una copia de los datos que conservamos sobre usted;</li>
  <li><strong>Corregir</strong> datos inexactos;</li>
  <li><strong>Eliminar</strong> su cuenta y sus datos (excepto los registros de los que dependen otras partes en nuestras mesas de financiación, según se describe en la Sección 11, y sujeto a retenciones legales);</li>
  <li><strong>Optar por no participar</strong> en analíticas y funciones opcionales;</li>
  <li><strong>Portar</strong> sus datos mediante exportación en un formato estándar.</li>
</ul>
<p>No vendemos información personal ni la "compartimos" para publicidad conductual entre contextos. Para ejercer cualquier derecho, contacte a <strong>privacy@almstins.com</strong>.</p>

<h2>17. Cambios a Esta Política</h2>
<p>Podemos actualizar esta Política. Los cambios materiales serán notificados por correo electrónico o mediante un aviso dentro del producto; el uso continuado tras la fecha de vigencia constituye la aceptación de los mismos.</p>

<h2>18. Contacto</h2>
<p>Responsable de Privacidad — Almstins LLC — <strong>privacy@almstins.com</strong></p>
`,
};

export const fr: PrivacyLocale = {
  lang: 'fr',
  summaryLabel: 'Politique de Confidentialité',
  ariaLabel: 'Politique de Confidentialité',
  body: `
<h1>POLITIQUE DE CONFIDENTIALITÉ D'ALMSTINS</h1>
<p><strong>Date d'entrée en vigueur :</strong> 12 octobre 2026 &nbsp;&middot;&nbsp; <strong>Version :</strong> 1.2<br/>
<strong>Opérateur :</strong> Almstins LLC (« Almstins », « nous », « notre »)</p>

<hr/>

<h2>1. Introduction</h2>
<p>La présente Politique de Confidentialité explique les informations qu'Almstins collecte, la manière dont nous les utilisons et les protégeons, ainsi que les choix dont vous disposez lorsque vous utilisez almstins.com et les applications et fonctionnalités associées (le « Service »).</p>

<p><strong>Principe fondamental — isolation des locataires.</strong> Almstins fonctionne selon une stricte isolation des locataires. Vos données vous appartiennent et sont séparées de celles de tout autre utilisateur. Nos outils d'administration n'affichent que ce dont nous avons besoin pour faire fonctionner le Service : l'adresse e-mail de chaque compte, ses dates d'inscription et de dernière connexion, et le nombre de wallets, de comptes d'exchange et d'importations qu'il comporte, ainsi qu'un journal de 30 jours des nombres de synchronisations, d'importations et de classements automatiques (par exemple, combien de transactions ont été classées, écartées comme poussière ou restent à vérifier). Nous lisons les messages de support que vous nous envoyez, et nous recevons un e-mail lorsqu'un compte est créé ou souscrit un abonnement. Nos outils d'administration n'affichent ni vos transactions, ni vos adresses de wallet, ni vos documents. Vos données ne sont jamais utilisées à d'autres fins que celles indiquées à la Section 4.</p>

<h2>2. Notre Architecture de Confidentialité (Garanties Contraignantes)</h2>
<p>Il s'agit d'engagements architecturaux qui fondent chaque section ci-dessous :</p>

<ul>
  <li><strong>Pas d'attribution.</strong> Nous ne lions jamais une adresse blockchain à l'identité d'une personne. Nous n'effectuons pas de KYC, de vérification d'identité, de regroupement d'adresses ni de désanonymisation, et nous ne constituons aucun répertoire reliant des adresses à des personnes. En dehors des étiquettes de votre propre compte, que vous seul voyez, les seuls noms que nous affichons à côté d'une adresse proviennent de notre propre liste de contrats et d'exchanges connus ; de registres publics publiés pour l'adresse, comme un nom ENS ou le nom d'un contrat publié avec son code source vérifié sur Etherscan ; ou d'une organisation qui a prouvé qu'elle contrôle l'adresse et a choisi de la publier (Section 5).</li>
  <li><strong>Isolation des locataires.</strong> Chaque enregistrement est limité à votre compte. Aucun utilisateur, et aucun opérateur en marque blanche, ne peut accéder aux données d'un autre locataire. Les exceptions sont les enregistrements que vous choisissez de partager, comme les Destinations Verify dont vous prouvez le contrôle, qui répondent aux vérifications publiques comme décrit à la Section 5 ; les fiches de créances, que toute personne détenant l'identifiant d'une créance peut consulter (Section 3.1) ; et les preuves que vous téléversez via un lien d'attestation, que peuvent voir les personnes qui vous ont envoyé ce lien (Section 3.1).</li>
  <li><strong>Pas de surveillance.</strong> Nous ne suivons pas votre comportement hors de la plateforme et ne surveillons pas proactivement les adresses blockchain de tiers. Vous fournissez les adresses et les enregistrements que vous souhaitez organiser.</li>
  <li><strong>Lecture seule, sans garde.</strong> Nous ne détenons jamais de clés et ne déplaçons jamais de fonds, de sorte que nous ne possédons jamais les identifiants qui rendraient vos actifs accessibles via nous.</li>
</ul>

<h2>3. Informations que Nous Collectons</h2>

<h3>3.1 Informations que vous fournissez directement</h3>
<ul>
  <li><strong>Informations de compte :</strong> votre adresse e-mail ; si vous vous inscrivez avec un mot de passe, une empreinte à sens unique salée de ce mot de passe (jamais le mot de passe lui-même) ; vos dates d'inscription et de dernière connexion ; une adresse e-mail facultative distincte pour les alertes ; et votre niveau d'abonnement. Si vous vous connectez avec Google ou GitHub, nous conservons aussi le numéro de compte avec lequel ce fournisseur vous identifie (Section 10). <strong>Nous ne vous demandons pas votre nom pour créer un compte :</strong> nous ne conservons pas le nom fourni par Google ou GitHub, et l'inscription par e-mail et mot de passe ne demande qu'un e-mail et un mot de passe. Un nom peut toutefois nous parvenir par les voies indiquées ci-dessous, par exemple dans une fiche de créance, dans une attestation ou comme nom d'expéditeur d'un e-mail que vous nous envoyez. (Stripe peut conserver un nom de facturation si vous vous abonnez.)</li>
  <li><strong>Données de cryptomonnaies :</strong> les adresses de wallet que vous fournissez, l'historique public sur la chaîne pour ces adresses, et les enregistrements de transactions.</li>
  <li><strong>Étiquettes et notes d'adresses :</strong> les étiquettes et notes que vous rédigez, y compris un numéro de téléphone facultatif pour une contrepartie (par exemple, un contact Venmo). Elles restent dans votre compte (Section 5).</li>
  <li><strong>Données financières :</strong> les CSV d'exchanges que vous importez, les montants de transactions, la base de coût et les gains/pertes.</li>
  <li><strong>Pièces jointes de documents :</strong> les images de reçus, les PDFs et les documents justificatifs que vous téléversez.</li>
  <li><strong>Fiches de créances (si vous utilisez le bureau des créances) :</strong> les noms des clients et des débiteurs, les détails des factures, les instructions de paiement, les fichiers de contrat que vous joignez et les adresses e-mail des personnes à qui vous demandez une confirmation. Toute personne détenant l'identifiant d'une créance peut consulter cette fiche sans compte, y compris les noms, les montants, les instructions de paiement, les revendications enregistrées sur celle-ci et les confirmations, mais pas les fichiers joints. L'identifiant est calculé à partir des détails de la fiche : toute personne qui connaît exactement ces détails peut donc aussi le calculer. Les personnes à qui vous demandez une confirmation peuvent aussi ouvrir les fichiers que vous joignez.</li>
  <li><strong>Preuves que vous téléversez via un lien d'attestation que quelqu'un vous envoie :</strong> votre réponse, le nom que vous saisissez, vos notes, les fichiers et photos que vous téléversez, une signature que vous dessinez et, si vous autorisez votre navigateur à la partager, la position de votre appareil au moment où vous prenez une photo. Une photo ou un fichier conserve aussi les données qu'il contient, comme le lieu et l'heure de prise d'une photo, si votre appareil photo les a enregistrés. Les personnes qui vous ont envoyé le lien peuvent voir l'ensemble de ces éléments.</li>
  <li><strong>Contenu Communautaire :</strong> nous ne proposons pas actuellement de signalements de fraude ni d'avis, et rien n'est collecté par leur intermédiaire. Les revendications d'adresses se font via Almstins Verify (Section 5). Voir la Section 6.</li>
  <li><strong>Communications :</strong> tickets de support, retours, rapports d'erreurs et e-mails que vous nous envoyez, que nous conservons avec le nom d'expéditeur affiché par votre messagerie.</li>
</ul>

<h3>3.2 Informations collectées automatiquement</h3>
<ul>
  <li><strong>Données d'utilisation :</strong> pages visitées, fonctionnalités utilisées, durée de la session.</li>
  <li><strong>Informations sur l'appareil :</strong> type de navigateur, système d'exploitation et adresse IP (cette dernière est également utilisée pour les contrôles de sanctions et de géolocalisation).</li>
  <li><strong>Données de journalisation :</strong> horodatages des actions, journaux d'erreurs, appels API.</li>
  <li><strong>Analytique :</strong> Google Analytics enregistre les pages que vous visitez et les actions indiquées à la Section 9 sous un identifiant de cookie propre à votre navigateur. Nos propres journaux des requêtes vers les pages du tableau de bord et de connexion conservent la page, votre pays et des empreintes à sens unique salées de votre adresse IP et des informations de votre navigateur. Nos journaux des vérifications effectuées sur les outils de vérification publics conservent votre pays et des empreintes à sens unique salées de votre adresse IP et de l'adresse ou du domaine vérifié. Voir les Sections 9 et 10.</li>
</ul>

<h3>3.3 Informations que nous ne collectons PAS</h3>
<ul>
  <li>Clés privées ou seed phrases (nous ne les demandons jamais).</li>
  <li>Clés API ni mots de passe de vos comptes d'exchange (les données sont importées via CSV ou via des captures d'écran que vous téléversez, ou lues par adresse publique).</li>
  <li>Identifiants biométriques ou pièces d'identité gouvernementales.</li>
  <li>Données de liaison d'identité — nous n'effectuons pas de KYC.</li>
  <li>Numéros de cartes ni identifiants de connexion à votre propre banque. Nous ne les demandons jamais, et les données de carte servant à la facturation sont traitées exclusivement par Stripe. Le bureau des créances comporte un champ facultatif d'instructions de paiement : ce que vous y saisissez, qui peut inclure des coordonnées bancaires, est enregistré avec cette fiche et montré à toute personne détenant son identifiant (Section 3.1). Si une capture d'écran ou un reçu que vous téléversez affiche un numéro de compte ou de carte, il fait partie de cette image : nous conservons les images que vous enregistrez dans votre compte (Section 3.1) et transmettons à Anthropic les captures que vous nous demandez de lire ainsi que les images de reçus que vous joignez avec un abonnement payant (Section 8).</li>
</ul>

<h2>4. Comment Nous Utilisons les Informations</h2>
<p>Nous utilisons les informations uniquement pour :</p>
<ul>
  <li>Vous fournir le Service (p. ex., calculer la base de coût, afficher votre tableau de bord, générer des rapports, effectuer les vérifications de sécurité que vous demandez).</li>
  <li>Authentifier votre compte et prévenir les accès non autorisés, la fraude et les abus.</li>
  <li>Comparer les liens et les adresses de wallet qui figurent dans les e-mails envoyés à nos propres boîtes de réception ou depuis celles-ci avec des listes d'hameçonnage, de sanctions et de mixeurs que nous conservons nous-mêmes. Pour cela, rien de ces messages n'est transmis à un service extérieur.</li>
  <li>Répondre aux vérifications publiques portant sur les Destinations Verify dont vous avez prouvé le contrôle (Section 5), et montrer une fiche de créance à toute personne détenant son identifiant (Section 3.1).</li>
  <li>Vous envoyer une courte série d'e-mails de prise en main après votre inscription, et une série consacrée à Almstins Verify après l'enregistrement de votre première Destination Verify. Ils présentent des fonctionnalités, y compris nos abonnements payants. Les comptes qui n'utilisent que nos bureaux de financement ne reçoivent pas la première série. Chaque e-mail contient un lien de désabonnement qui arrête le reste de cette série.</li>
  <li>Faire fonctionner les fonctionnalités de sécurité communautaire, si elles sont proposées, de manière anonymisée et agrégée (Section 6).</li>
  <li>Répondre à vos demandes de support.</li>
  <li>Améliorer le Service grâce à l'analytique (Sections 3.2 et 9).</li>
  <li>Respecter les obligations légales et les procédures judiciaires valides.</li>
</ul>

<p><strong>Nous n'utilisons jamais</strong> vos informations à des fins de publicité (y compris la publicité ciblée), de profilage, d'entraînement de modèles ou de vente, et nous ne les partageons jamais avec des tiers à leurs propres fins commerciales.</p>

<h2>5. Traitement des Adresses Blockchain</h2>
<ul>
  <li><strong>Ce que nous collectons :</strong> les adresses que vous saisissez, les adresses extraites de vos CSV importés, et les adresses observées dans les données publiques sur la chaîne pour les wallets que vous ajoutez. Les adresses de contreparties peuvent être automatiquement ajoutées à votre carnet d'adresses privé pour vous aider à organiser vos transactions.</li>
  <li><strong>Les étiquettes restent dans votre compte.</strong> Une étiquette que vous enregistrez (p. ex., « Café de Jean »), ainsi que tout numéro de téléphone que vous y ajoutez, ne réside que dans votre compte et n'est jamais publiée ni partagée avec d'autres comptes. Les étiquettes que vous donnez aux Destinations Verify ne sont pas affichées publiquement non plus, à la seule exception décrite ci-dessous. Par ailleurs, le Service affiche des noms de contrats et d'exchanges connus tirés d'une liste que nous établissons nous-mêmes, ainsi que des noms publics ENS et de contrats Etherscan.</li>
  <li><strong>Pas d'attribution.</strong> Nous n'associons jamais une adresse à une personne et ne constituons pas de carte publique adresse-vers-identité. Lorsque vous utilisez vos propres enregistrements pour prouver votre propre propriété, il s'agit de votre divulgation volontaire — et non de quelque chose que nous effectuons sur vous ou sur d'autres.</li>
  <li><strong>Conservation/suppression :</strong> les adresses sont conservées aussi longtemps que nécessaire pour fournir le Service et conformément aux exigences légales de conservation ; vous pouvez les supprimer conformément à la Section 11.</li>
  <li><strong>Almstins Verify — Destinations enregistrées :</strong> si vous utilisez Almstins Verify, nous stockons les Destinations de paiement que vous enregistrez (adresses de réception, codes QR ou liens), toute étiquette que vous leur donnez et la <strong>preuve que vous les contrôlez</strong>. Vous prouvez le contrôle par un petit paiement que vous envoyez depuis l'adresse vers elle-même, que nous lisons sur la chaîne ; par un fichier ou un enregistrement DNS que vous publiez sur votre propre domaine, qui peut inclure une liste chiffrée de vos adresses ; ou, pour un lien de paiement, en l'enregistrant depuis un compte qui a déjà prouvé son domaine. Nous ne vous demandons jamais de connecter un wallet, de signer un message ni de nous fournir des clés. Pour un QR de paiement PIX ou UPI, nous conservons aussi le nom du bénéficiaire ou du commerçant qu'il contient, qui n'est affiché qu'à vous. Nous utilisons ces données pour surveiller ces Destinations, vous alerter en cas de changement, répondre aux vérifications publiques une fois une Destination prouvée et déclencher les e-mails de prise en main de Verify (Section 4). Les scans de QR par caméra (Section 7) sont <strong>décodés sur l'appareil</strong> : nous ne recevons que la chaîne de destination décodée, jamais l'image. Nous <strong>ne</strong> relions <strong>pas</strong> vos Destinations à vos clients et <strong>ne</strong> surveillons <strong>pas</strong> de tiers.</li>
  <li><strong>Ce que montre une vérification publique :</strong> une fois que vous avez prouvé une Destination, toute personne qui saisit cette adresse ou ce lien dans nos outils de vérification, ou qui interroge notre recherche publique, peut voir qu'elle est <strong>Revendiquée</strong> (Claimed) ou <strong>Vérifiée</strong> (Verified), depuis quelle date, et sa blockchain ou son réseau de paiement. Pour une Destination Vérifiée, la réponse affiche aussi le domaine qui l'a publiée et, si votre compte a un nom commercial vérifié, ce nom et le domaine dont il provient. Une étiquette que vous avez saisie n'est jamais affichée publiquement, sauf une étiquette qui correspond au nom d'un domaine que vous avez prouvé (par exemple Acme pour acme.com), qui devient votre nom commercial vérifié. Une Destination que vous n'avez pas prouvée n'est jamais affichée. Votre e-mail, votre compte et vos artefacts de preuve ne sont jamais montrés à quiconque. Il s'agit de votre divulgation volontaire de votre propre Destination ; ce n'est pas l'attribution d'un tiers, et nous n'effectuons toujours aucun KYC et ne constituons aucun répertoire reliant des adresses à des personnes.</li>
  <li><strong>Almstins Verified Entity — vérification publique des adresses (B.8) :</strong> si vous exploitez une Verified Entity (un exchange, une entreprise, une institution ou une autre organisation), vous pouvez enregistrer un domaine que vous contrôlez et publier, sur ce domaine, les adresses de réception que vous déclarez comme étant les vôtres. Ici, <strong>par conception et selon votre choix, les adresses vérifiées et le domaine qui les a publiées sont affichés publiquement</strong> — afin que quiconque puisse vérifier une adresse avant de la payer. Il s'agit de l'<strong>auto-divulgation volontaire par votre organisation de ses propres adresses</strong>, et non d'une attribution que nous effectuons. Nous confirmons le contrôle par <strong>Domain Attestation</strong> (un défi émis par Almstins que vous placez sur votre propre domaine). Nous lisons ensuite votre liste d'adresses depuis un point de terminaison (endpoint) de votre domaine, à l'aide d'une clé API en lecture seule que vous nous fournissez et que nous stockons chiffrée, puis nous <strong>mettons en cache et reflétons</strong> ce que votre domaine publie ; votre enregistrement publié fait foi. <strong>L'identité de votre compte (e-mail), les artefacts de preuve et le lien entre votre compte et votre domaine demeurent privés et sous isolation des locataires</strong>, jamais affichés. Nous ne relions toujours <strong>jamais</strong> l'adresse d'un <strong>tiers</strong> à une identité, n'effectuons aucun KYC et ne constituons aucun répertoire public ou inter-locataires adresse-vers-identité pour quiconque n'a pas lui-même prouvé le contrôle. Nous n'utilisons pas les consultations publiques de vérification pour profiler qui consulte. Vous pouvez révoquer une adresse à tout moment en la retirant de votre enregistrement publié. S'applique lorsque et là où cette Surface est proposée.</li>
</ul>

<h2>6. Fonctionnalités de Sécurité Communautaire (Signalements, Avis, Revendications, Badges)</h2>
<p><em>Applicable lorsque et où ces fonctionnalités sont proposées.</em></p>
<ul>
  <li><strong>Situation actuelle :</strong> nous ne proposons pas actuellement de signalements de fraude ni d'avis, et rien n'est collecté par leur intermédiaire. Si nous les proposons, les règles de cette section s'appliqueront.</li>
  <li><strong>Ce qui est stocké :</strong> le signalement de fraude ou l'avis structuré, associé à une <strong>adresse</strong> blockchain, non à une personne.</li>
  <li><strong>Les avis</strong> sont uniquement des sélections prédéfinies (sans texte libre, sans notation par étoiles) ; seuls les <strong>totaux agrégés</strong> sont affichés, jamais un avis individuel ni l'identité de l'évaluateur.</li>
  <li><strong>L'identité du déclarant/revendicateur</strong> est stockée uniquement à des fins de prévention des abus et de limitation du débit, et n'est <strong>jamais affichée</strong> ni associée à une personne publiquement ou auprès d'autres locataires.</li>
  <li><strong>Validation :</strong> les signaux de fraude publiés sont filtrés par un tiers indépendant (p. ex., GoPlus) ; nous ne publions pas le nombre d'utilisateurs.</li>
  <li><strong>Revendications et preuve de contrôle :</strong> aujourd'hui, la seule façon de revendiquer une adresse est Almstins Verify. Vous prouvez le contrôle comme décrit à la Section 5, par exemple par un petit paiement que vous envoyez depuis l'adresse vers elle-même. <strong>Nous ne vous demandons jamais de connecter un wallet, de signer un message ni de fournir des clés.</strong> Une revendication prouvée peut être vérifiée publiquement comme décrit à la Section 5.</li>
  <li><strong>Badges :</strong> lorsqu'une personne vérifie une Destination Verify prouvée, nos outils de vérification peuvent afficher un badge Revendiquée ou Vérifiée avec les informations indiquées à la Section 5, et rien de plus.</li>
  <li><strong>Les corrections</strong> sont gérées par revalidation auprès de la source indépendante, sans divulguer qui a contribué un signal.</li>
</ul>

<h2>7. Vérification des Commerçants et Fonctionnalités de Caméra</h2>
<p><em>S'applique partout où le Service utilise votre caméra : l'outil de vérification de wallets, Almstins Verify et les liens d'attestation.</em></p>
<ul>
  <li><strong>Les scans ponctuels de QR</strong> sont décodés <strong>sur votre appareil</strong> ; l'image n'est jamais stockée ni transmise. La caméra ne fonctionne que tant que le scanner est ouvert et s'arrête au premier code lu. Une adresse de wallet scannée est vérifiée immédiatement. Dans l'outil de vérification de wallets, un lien scanné est placé dans le champ et n'est vérifié que lorsque vous appuyez sur le bouton de vérification. Sur la page de scan de Verify, et lorsque vous vérifiez un panneau depuis votre tableau de bord Verify, un lien scanné est vérifié immédiatement. Une vérification transmet ce qui a été scanné à nos serveurs, et une adresse ou un lien web est aussi transmis aux services de vérification indiqués à la Section 10.</li>
  <li><strong>Photos de preuve :</strong> un lien d'attestation que quelqu'un vous envoie peut ouvrir votre caméra pour que vous photographiiez un travail comme preuve. Ces photos sont téléversées et stockées, comme décrit à la Section 3.1.</li>
  <li><strong>Pas de caméra permanente.</strong> Almstins ne dispose d'aucune fonctionnalité de caméra continue ou permanente.</li>
</ul>

<h2>8. Fonctionnalités d'IA</h2>
<p>Certaines fonctionnalités transmettent des données à notre fournisseur d'IA, <strong>Anthropic (Claude)</strong>, dans les cas suivants :</p>
<ul>
  <li><strong>Lecture de captures d'écran :</strong> lorsque vous utilisez « Scanner la capture » (libellés d'adresses), « Importer une capture » ou « Analyser et importer » (captures enregistrées sur la page Transactions), l'image entière est transmise afin que Claude lise l'adresse de wallet ou la transaction qu'elle contient. Tout ce qui y est visible, comme des noms, des montants et des informations de compte, est également transmis ; recadrez donc l'image pour en exclure ce que vous préférez ne pas partager. Contrairement aux scans de QR par caméra (Sections 5 et 7), qui sont décodés sur votre appareil, ces images quittent votre appareil.</li>
  <li><strong>Classification des transactions</strong> (abonnements payants) : pour chaque transaction non résolue, son sens (entrée ou sortie), l'actif, le montant, la valeur en USD, le type, la description, la source, la date, ainsi que vos propres notes et votre catégorie.</li>
  <li><strong>Validation des reçus</strong> (abonnements payants) : chaque fois que vous joignez l'image d'un reçu à une transaction sur la page Recherche, l'image est transmise automatiquement pour être comparée à cette transaction. Il n'y a pas d'étape distincte. Les PDFs ne sont pas transmis.</li>
</ul>
<p>Les résultats ne sont pas définitifs. Les adresses lues dans une capture sont placées dans le formulaire pour que vous les vérifiiez avant de les enregistrer. Une transaction lue dans une capture est enregistrée immédiatement dans vos données ; vérifiez-la et supprimez cette importation si elle est erronée. La classification attribue une catégorie et une note aux transactions qu'elle juge clairement être un achat, un revenu ou un transfert entre vos propres wallets, lorsqu'elles n'ont pas encore de catégorie, et vous laisse les autres ; vous pouvez modifier chacune d'elles. Les résultats de la validation des reçus sont des suggestions que vous examinez.</p>

<h2>9. Cookies et Analytics</h2>
<p>Nous utilisons un petit nombre de cookies et d'éléments de stockage similaires dans le navigateur :</p>
<ul>
  <li><strong>Essentiels :</strong> votre session de connexion et ses contrôles de sécurité, ainsi que la session de démonstration si vous essayez la démo. Le Service ne fonctionne pas sans eux.</li>
  <li><strong>Préférences :</strong> la langue que vous choisissez et de petits réglages, comme la taille du texte ou le fait d'avoir déjà vu l'introduction d'une page, conservés dans votre navigateur.</li>
  <li><strong>Analytique :</strong> <strong>Google Analytics</strong> dépose ses propres cookies pour compter les visites, voir quelles pages sont utilisées et compter quelques actions nommées : l'inscription, la déconnexion, l'ajout d'un wallet (avec la blockchain choisie), l'utilisation de l'outil de vérification de wallets, l'utilisation de l'outil de vérification de sites (avec son résultat rouge, jaune ou vert), un clic sur un bouton d'inscription de la page de vérification et l'utilisation de la démo (la lancer, la quitter, consulter ses pages et son récapitulatif de fin d'année, ou cliquer sur son bouton d'inscription). Notre balise désactive Google signals et la personnalisation des annonces. Nous conservons aussi un petit marqueur dans votre navigateur afin de ne compter qu'une seule fois l'inscription d'un nouveau compte. La Section 10 indique ce que reçoit Google Analytics.</li>
</ul>
<p>Nous n'utilisons pas de cookies à des fins publicitaires. Nous n'affichons pas actuellement de bandeau de consentement aux cookies. Pour refuser Google Analytics, bloquez les cookies d'almstins.com dans votre navigateur, utilisez un bloqueur de contenu ou installez le module complémentaire de désactivation de Google pour navigateurs. Le Service fonctionne sans les cookies d'analytique.</p>

<h2>10. Services Tiers</h2>
<p>Nous partageons le minimum de données nécessaire avec les prestataires de services ci-dessous, regroupés par finalité. Le cas échéant, nous indiquons ce que chacun reçoit.</p>
<ul>
  <li><strong>Connexion :</strong> <strong>Google</strong> et <strong>GitHub</strong>, uniquement si vous choisissez de vous connecter avec eux. Ils nous communiquent votre adresse e-mail et votre profil de base (comme votre nom et votre photo). Nous conservons votre e-mail et le numéro de compte avec lequel le fournisseur vous identifie, ce qui nous permet de vous reconnaître lors de votre prochaine connexion. Nous ne conservons ni votre nom, ni votre photo, ni les jetons de connexion du fournisseur. Ils apprennent que vous vous êtes connecté à Almstins.</li>
  <li><strong>Facturation :</strong> <strong>Stripe</strong> reçoit votre e-mail, votre abonnement et un identifiant de compte interne. Vous saisissez vos données de carte directement auprès de Stripe, un prestataire PCI-DSS Level 1 ; nous ne les voyons jamais.</li>
  <li><strong>Hébergement et base de données :</strong> <strong>Render</strong> héberge le Service, notre base de données Postgres et nos journaux serveur. Render diffuse le site via le réseau de <strong>Cloudflare</strong>, qui voit chaque requête et votre adresse IP.</li>
  <li><strong>E-mail :</strong> un fournisseur <strong>e-mail/SMTP</strong> (liens de connexion, vérification, e-mails de bienvenue, d'alerte et de compte, et messages que vous nous demandez d'envoyer à une contrepartie), <strong>Resend</strong> (e-mails de prise en main après votre inscription ou l'enregistrement de votre première destination Verify) et les prestataires qui hébergent nos propres boîtes de réception, dont <strong>Google (Gmail)</strong> (messages de support, de contact et de demande d'aide au rapprochement, rapports d'erreurs et avis de nouvelles inscriptions et de nouveaux abonnements). Chacun reçoit l'adresse e-mail du destinataire et le message.</li>
  <li><strong>Analytique :</strong> <strong>Google Analytics</strong> reçoit les pages que vous visitez et la page d'où vous venez (chacune sans la partie de l'adresse web qui suit le « ? », sauf les balises de campagne comme utm_source), les actions nommées indiquées à la Section 9, un identifiant de cookie, des informations sur votre navigateur et votre adresse IP. Notre balise désactive Google signals et la personnalisation des annonces. <strong>IPinfo</strong> reçoit votre adresse IP, pour en déterminer le pays ; de cette consultation, nous ne conservons que le pays, classé sous une empreinte à sens unique de l'adresse IP. Certaines pages chargent aussi des polices, des icônes ou des images directement depuis <strong>Google Fonts</strong>, le service d'icônes de Google, <strong>jsDelivr</strong> et des hébergeurs d'images, qui voient votre adresse IP et votre navigateur comme tout site web. À partir des icônes qu'une page demande, ces services peuvent savoir quels exchanges ou tokens figurent dans votre compte.</li>
  <li><strong>Données blockchain :</strong> <strong>Alchemy, Etherscan, Routescan/Snowtrace</strong> (Avalanche), <strong>Blockstream</strong> (Bitcoin), <strong>litecoinspace.org</strong> (Litecoin), un fournisseur RPC <strong>Solana</strong>, <strong>Mysten Labs</strong> (Sui), le nœud public <strong>Rootstock</strong>, <strong>Sovryn</strong> et <strong>The Graph</strong> (subgraphs), ainsi que l'API <strong>Aave</strong>. Ils reçoivent les adresses de wallet publiques et les identifiants de transaction que nous devons lire, jamais les informations de votre compte.</li>
  <li><strong>Cours :</strong> <strong>CoinGecko, DefiLlama</strong> et <strong>Yahoo Finance</strong> reçoivent les tokens ou les symboles boursiers à valoriser et les dates, jamais votre adresse de wallet ni les informations de votre compte.</li>
  <li><strong>Vérifications de sécurité :</strong> <strong>GoPlus Security, honeypot.is, Chainalysis</strong> (son service de criblage des sanctions), <strong>Chainabuse</strong> (exploité par TRM Labs), <strong>Google Safe Browsing, VirusTotal</strong> et <strong>URLScan.io</strong> reçoivent l'adresse ou le lien vérifié ; nous n'ajoutons rien vous concernant à une vérification. Pour un lien, GoPlus, Google Safe Browsing et VirusTotal reçoivent le lien complet, y compris tout ce qui suit le domaine, tandis qu'URLScan.io ne reçoit que le domaine. Nous demandons seulement à VirusTotal s'il dispose déjà de résultats pour un lien ; nous ne lui soumettons jamais un lien à analyser. Évitez de vérifier des liens contenant des codes d'accès privés ou des données personnelles, y compris des liens privés que quelqu'un vous a envoyés. La Section 13 en dit plus sur les services exploités par des sociétés d'analyse de blockchain.</li>
  <li><strong>IA :</strong> <strong>Anthropic</strong> reçoit ce que transmettent les fonctionnalités d'IA décrites à la Section 8, uniquement lorsque vous les utilisez.</li>
  <li><strong>Horodatage :</strong> les serveurs de calendrier <strong>OpenTimestamps</strong> (exploités par OpenTimestamps, Eternity Wall et Catallaxy) ne reçoivent qu'une empreinte SHA-256 à sens unique, jamais l'enregistrement lui-même. Blockstream fournit les données publiques de blocs Bitcoin utilisées pour vérifier un horodatage.</li>
</ul>
<p>Nous téléchargeons aussi des listes publiques d'hameçonnage, de sanctions et de cours (par exemple depuis GitHub et CoinPaprika) ; ces requêtes ne contiennent rien vous concernant. Ces prestataires ont leurs propres pratiques en matière de confidentialité ; nous ne sommes pas responsables de leur traitement des données.</p>

<h2>11. Conservation des Données</h2>
<p>Nous conservons les données tant que votre compte est ouvert et aussi longtemps que nécessaire pour fournir le Service, respecter les obligations légales, et résoudre les litiges et faire respecter nos accords. Vous pouvez supprimer vous-même votre compte et vos données à tout moment, ou nous le demander à privacy@almstins.com. La suppression efface toutes les données de votre compte, à l'exception des enregistrements sur lesquels d'autres parties s'appuient dans nos bureaux de financement, comme les créances, les projets, les revendications, les confirmations, les attestations et leurs documents, que nous conservons pour ces parties conformément à la présente section. Nous ne conservons pas vos dossiers fiscaux pour vous après la suppression de votre compte : exportez d'abord ce dont vous avez besoin ; les dossiers fiscaux doivent souvent être conservés 7 ans ou plus. Les e-mails que vous avez envoyés à nos boîtes de réception et les données de facturation conservées par Stripe ne font pas partie des données de votre compte ; vous pouvez nous demander à privacy@almstins.com de supprimer ces e-mails. Les données supprimées ne peuvent pas être récupérées depuis le Service, mais elles peuvent subsister dans les sauvegardes de notre hébergeur de base de données jusqu'à leur expiration.</p>

<h2>12. Sécurité</h2>
<p>Nous appliquons des mesures conformes aux normes du secteur, notamment HTTPS pour les données en transit ; le chiffrement au repos des données stockées, assuré par notre hébergeur de base de données ; un chiffrement supplémentaire AES-256-GCM, appliqué par nous, pour les clés API des Verified Entity et pour la copie enregistrée d'une liste d'adresses (roster) ; le contrôle d'accès basé sur les rôles ; et des protocoles de réponse aux violations. Cependant, aucun système n'est entièrement sécurisé et nous ne pouvons garantir une protection absolue contre toutes les attaques ou violations.</p>

<h2>13. Demandes Légales et Forces de l'Ordre</h2>
<p>Nous ne pouvons divulguer des données que si cela est exigé par une procédure judiciaire valide (telle qu'une citation à comparaître ou une ordonnance du tribunal) ou pour enquêter sur une fraude ou un abus avec l'autorité légale appropriée. <strong>Nous ne partageons pas de données avec les forces de l'ordre sans procédure judiciaire valide, et les sociétés d'analyse de blockchain ne reçoivent de notre part rien d'autre que les vérifications d'adresses décrites ci-dessous.</strong> Dans la mesure où la loi le permet, nous vous informerons des demandes légales visant vos données. Nous ne donnons pas suite aux demandes informelles.</p>
<p><strong>Vérifications d'adresses et de liens.</strong> Lorsqu'une vérification d'adresse ou de lien nous est demandée, par vous ou par toute personne utilisant nos outils de vérification, nos serveurs transmettent cette adresse ou ce lien aux services de vérification indiqués à la Section 10. Parmi eux figurent des services exploités par les sociétés d'analyse de blockchain Chainalysis et TRM Labs (qui exploite Chainabuse). Une vérification ne transmet que l'adresse ou le lien (et, pour certains services, la blockchain concernée), et rien d'autre vous concernant : ni votre nom, ni votre e-mail, ni l'identifiant de votre compte, ni votre adresse IP. Il ne s'agit que de consultations : nous ne soumettons jamais un lien ou une adresse à analyser. Les adresses et les liens des e-mails envoyés à nos propres boîtes de réception ou depuis celles-ci ne sont comparés qu'à des listes que nous conservons nous-mêmes et ne sont jamais transmis à ces services. Nous ne déposons aucun signalement d'arnaque ou de fraude concernant qui que ce soit, ni auprès de ces services ni auprès de quiconque.</p>

<h2>14. Transferts Internationaux de Données</h2>
<p>Vos données peuvent être traitées et stockées aux États-Unis ou dans d'autres pays. En utilisant le Service, vous consentez à ce transfert et à ce traitement, sous réserve du droit applicable en matière de protection des données.</p>

<h2>15. Confidentialité des Mineurs</h2>
<p>Le Service est destiné aux utilisateurs âgés de 18 ans et plus. Nous ne collectons pas sciemment de données auprès de mineurs et supprimerons ces données si nous les découvrons.</p>

<h2>16. Vos Droits</h2>
<p>Sous réserve du droit applicable (notamment le GDPR et le CCPA), vous pouvez :</p>
<ul>
  <li><strong>Accéder</strong> à une copie des données que nous détenons à votre sujet ;</li>
  <li><strong>Rectifier</strong> des données inexactes ;</li>
  <li><strong>Supprimer</strong> votre compte et vos données (à l'exception des enregistrements sur lesquels d'autres parties s'appuient dans nos bureaux de financement, comme décrit à la Section 11, et sous réserve de conservations légales) ;</li>
  <li><strong>Vous opposer</strong> aux analyses et aux fonctionnalités optionnelles ;</li>
  <li><strong>Portabiliser</strong> vos données via une exportation dans un format standard.</li>
</ul>
<p>Nous ne vendons pas d'informations personnelles et ne les « partageons » pas à des fins de publicité comportementale transcontextuelle. Pour exercer tout droit, contactez <strong>privacy@almstins.com</strong>.</p>

<h2>17. Modifications de Cette Politique</h2>
<p>Nous pouvons mettre à jour cette Politique. Les modifications importantes seront notifiées par e-mail ou par un avis dans le produit ; la poursuite de l'utilisation après la date d'entrée en vigueur constitue une acceptation.</p>

<h2>18. Contact</h2>
<p>Responsable de la Confidentialité — Almstins LLC — <strong>privacy@almstins.com</strong></p>
`,
};

const MAP: Record<Lang, PrivacyLocale> = { en, es, fr };

/** Select the Privacy locale for a language, falling back to English. */
export function getPrivacy(lang: Lang): PrivacyLocale {
  return MAP[lang] ?? en;
}
