// Privacy Policy — footer-modal content, all user-visible copy (EN · ES · FR).
//
// Operative Privacy Policy v1.2 (effective 2026-10-12; set this and the three body dates to the deploy day).
// ES and FR are first-pass legal translations pending review by a fluent legal translator
// (including the v1.2 changes to Sections 2, 3.3, 4, 8, 10 and 13).
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

<p><strong>Core principle — tenant isolation.</strong> Almstins operates under strict tenant isolation. Your data belongs to you, is segregated from every other user, is never accessed by operators, and is never used for any purpose other than providing the Service to you.</p>

<h2>2. Our Privacy Architecture (Binding Guarantees)</h2>
<p>These are architectural commitments that shape every section below:</p>

<ul>
  <li><strong>No attribution.</strong> We never link a blockchain address to a legal identity. We do not perform KYC, identity verification, address clustering, or de-anonymization, and we do not build any address-to-identity directory.</li>
  <li><strong>Tenant isolation.</strong> Every record is scoped to your account. No user — and no white-label operator — can access another tenant's data.</li>
  <li><strong>No surveillance.</strong> We do not track your off-platform behavior and do not proactively monitor third-party blockchain addresses. The one exception: we screen wallet addresses that appear in email sent to or from our own inboxes for scam and sanctions signals (Section 10). You provide the addresses and records you want organized.</li>
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
  <li>Exchange API keys or passwords (data is imported via CSV, via screenshots you upload, or read by public address).</li>
  <li>Biometric identifiers or government IDs.</li>
  <li>Identity-linking data — we do not perform KYC.</li>
  <li>Bank account numbers or credit/debit card numbers. We never ask for them, and card data for billing is handled solely by Stripe. If a screenshot or receipt you upload shows one, it is part of that image: we store images you save to your account (Section 3.1) and send screenshots you ask us to read to Anthropic (Section 8).</li>
</ul>

<h2>4. How We Use Information</h2>
<p>We use information only to:</p>
<ul>
  <li>Provide the Service to you (e.g., compute cost basis, render your dashboard, generate reports, run safety checks you request).</li>
  <li>Authenticate your account and prevent unauthorized access, fraud, and abuse.</li>
  <li>Screen wallet addresses that appear in email sent to or from our own inboxes for scam and sanctions signals (Section 10).</li>
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
  <li><strong>Almstins Verify — registered Destinations:</strong> if you use Almstins Verify, we store the payment Destinations you register (receiving addresses, QR codes, or links) and the <strong>ownership-proof artifacts</strong> you provide (e.g., a signature or domain record). This data is your own, held under tenant isolation, and used <strong>only</strong> to monitor those Destinations and alert you to changes. Camera-based QR scans (B.5.6 of the User Agreement) are <strong>decoded on-device</strong> — we receive only the decoded destination string, never the image. We do <strong>not</strong> link your Destinations to your customers and do <strong>not</strong> monitor third parties. A Destination you register is linked <strong>only to your own account (your email), privately and under tenant isolation</strong> — never shown to other users or the public, and never used to identify you. This is your voluntary self-association of your own Destination; it is not attribution of any third party, and we still perform no KYC and build no public or cross-tenant address-to-identity map.</li>
  <li><strong>Almstins Verified Entity — public address verification (B.8):</strong> if you operate a Verified Entity (an exchange, business, institution, or other organization), you may register a domain you control and publish, on that domain, the receiving addresses you represent as your own. Here, <strong>by design and at your choice, the verified addresses and the domain that published them are shown publicly</strong> — so anyone can check an address before paying it. This is your organization's <strong>voluntary self-disclosure of its own addresses</strong>, not attribution we perform. We confirm control by <strong>Domain Attestation</strong> (an Almstins-issued challenge you place on your own domain) and an optional per-address signature; we then <strong>read, cache, and mirror</strong> what your domain publishes — your published record is the source of truth. <strong>Your account identity (email), the proof artifacts, and the link between your account and your domain stay private and tenant-isolated</strong>, never displayed. We still <strong>never</strong> link a <strong>third party's</strong> address to an identity, perform no KYC, and build no public or cross-tenant address-to-identity directory for anyone who has not themselves proven control. We do not use public verification lookups to profile who is checking. You can revoke an address at any time by removing it from your published record. Applies where and when this Surface is offered.</li>
</ul>

<h2>6. Community Safety Features (Flags, Reviews, Claims, Badges)</h2>
<p><em>Applies when and where these features are offered.</em></p>
<ul>
  <li><strong>What is stored:</strong> the fraud flag, structured review, or claim, keyed to a blockchain <strong>address</strong> — not to a person.</li>
  <li><strong>Reviews</strong> are predefined selections only (no free text, no star ratings); only <strong>aggregate counts</strong> are displayed, never an individual review or reviewer identity.</li>
  <li><strong>Reporter/claimant identity</strong> is stored solely for abuse-prevention and rate-limiting and is <strong>never displayed</strong> or linked to a person publicly or to other tenants.</li>
  <li><strong>Validation:</strong> surfaced fraud signals are gated by an independent third party (e.g., GoPlus); we do not publish a user headcount.</li>
  <li><strong>Claims and control proof:</strong> if you claim an address, any control-proof step (e.g., a signature you generate in your own wallet and provide to us) is used only to verify control; <strong>we never ask you to connect a wallet or provide keys.</strong></li>
  <li><strong>Corrections</strong> are handled by re-validation against the independent source, not by disclosing who contributed a signal.</li>
</ul>

<h2>7. Merchant Verification &amp; Camera Features</h2>
<p><em>Applies to the optional merchant tier, when offered.</em></p>
<ul>
  <li><strong>One-time scans</strong> (QR/address) are decoded <strong>on-device</strong>; no image is stored or transmitted by that action.</li>
  <li><strong>Continuous/always-on camera monitoring</strong>, if enabled by a merchant, may capture third parties (bystanders, employees, customers). <strong>The merchant is the controller of that capture</strong> and is responsible for obtaining required consents, posting notices, and observing retention limits under applicable biometric, surveillance, two-party-consent, and employee-monitoring laws. Almstins does not request or use such footage to identify individuals.</li>
</ul>

<h2>8. AI Features</h2>
<p>Optional AI features send data to our AI provider, <strong>Anthropic (Claude)</strong>, only when you use them:</p>
<ul>
  <li><strong>Screenshot reading:</strong> when you use "Scan Screenshot" (address labels), "Import Screenshot", or "Parse &amp; import" (screenshots you saved on the Transactions page), the whole image is sent so Claude can read the wallet address or transaction in it. Anything visible in it, such as names, amounts, and account details, is sent too, so crop out anything you would rather not share. Unlike camera QR scans (Sections 5 and 7), which are decoded on your device, these images leave your device.</li>
  <li><strong>Transaction triage</strong> (paid plans): for each unresolved transaction, its direction, asset, amount, USD value, type, description, source, date, and your own notes and category.</li>
  <li><strong>Receipt validation</strong> (paid plans): the receipt image you attach. PDFs are not sent.</li>
</ul>
<p>Outputs are not authoritative. Addresses read from a screenshot are placed in the form for you to check before you save them. A transaction read from a screenshot is saved to your records right away; check it, and delete that import if it is wrong. Triage fills in a category and a note on transactions it rates as an obvious purchase, income, or own-wallet transfer when they have no category yet, and leaves the rest for you; you can change any of them. Receipt results are suggestions you review.</p>

<h2>9. Cookies &amp; Analytics</h2>
<p>We use cookies and similar technologies for essential functionality and for aggregated analytics via <strong>Google Analytics</strong>. Where required, we present a consent mechanism and honor your choices.</p>

<h2>10. Third-Party Services</h2>
<p>We share the minimum data needed with the service providers below, grouped by purpose. Where it matters, we say what each one receives.</p>
<ul>
  <li><strong>Sign-in:</strong> <strong>Google</strong> and <strong>GitHub</strong>, only if you choose to sign in with them. They share your email address and basic profile with us, and they learn that you signed in to Almstins.</li>
  <li><strong>Billing:</strong> <strong>Stripe</strong> receives your email, your plan, and an internal account ID. You enter card details directly with Stripe, a PCI-DSS Level 1 provider; we never see them.</li>
  <li><strong>Hosting and database:</strong> <strong>Render</strong> hosts the Service, our Postgres database, and our server logs. Render serves the site through <strong>Cloudflare</strong>'s network, which sees each request and your IP address.</li>
  <li><strong>Email:</strong> an <strong>email/SMTP</strong> provider (sign-in links, verification, welcome, alert, and account emails, and messages you ask us to send to a counterparty), <strong>Resend</strong> (getting-started emails after you sign up or first register a Verify destination), and the providers that host our own inboxes, including <strong>Google (Gmail)</strong> (support, contact, and reconciliation-help messages, error reports, and notices of new sign-ups and subscriptions). Each receives the recipient's email address and the message.</li>
  <li><strong>Analytics:</strong> <strong>Google Analytics</strong> (pages you visit, a cookie ID, browser details, and your IP address) and <strong>IPinfo</strong> (your IP address, to look up its country; from that lookup we keep only the country, filed under a one-way hash of the IP). Some pages also load fonts, icons, or images directly from <strong>Google Fonts</strong>, Google's icon service, <strong>jsDelivr</strong>, and image hosts, which see your IP address and browser as any website does. From the icons a page requests, those services can tell which exchanges or tokens appear in your account.</li>
  <li><strong>Blockchain data:</strong> <strong>Alchemy, Etherscan, Routescan/Snowtrace</strong> (Avalanche), <strong>Blockstream</strong> (Bitcoin), <strong>litecoinspace.org</strong> (Litecoin), a <strong>Solana</strong> RPC provider, <strong>Mysten Labs</strong> (Sui), the <strong>Rootstock</strong> public node, <strong>Sovryn</strong> and <strong>The Graph</strong> (subgraphs), and the <strong>Aave</strong> API. They receive the public wallet addresses and transaction IDs we need to read, never your account details.</li>
  <li><strong>Prices:</strong> <strong>CoinGecko, DefiLlama</strong>, and <strong>Yahoo Finance</strong> receive the tokens or stock symbols to price and the dates, never your wallet address or account details.</li>
  <li><strong>Safety checks:</strong> <strong>GoPlus Security, honeypot.is, Chainalysis</strong> (its sanctions-screening service), <strong>Chainabuse</strong> (run by TRM Labs), <strong>Google Safe Browsing, VirusTotal</strong>, and <strong>URLScan.io</strong> receive the address or link being checked; we add nothing about you to a check. For a link, GoPlus, Google Safe Browsing, and VirusTotal receive the full link, including anything after the domain, while URLScan.io receives only the domain. If VirusTotal has never seen a link, we ask it to scan that link, and VirusTotal may keep submitted links and share them with its security community. Avoid checking links that contain private access codes or personal details, including private links someone sent you. We run the same address checks on wallet addresses that appear in email sent to or from our own inboxes. Section 13 says more about the services run by chain-analysis firms.</li>
  <li><strong>AI:</strong> <strong>Anthropic</strong> receives what the AI features in Section 8 send, only when you use them.</li>
  <li><strong>Time-stamping:</strong> <strong>OpenTimestamps</strong> calendar servers (run by OpenTimestamps, Eternity Wall, and Catallaxy) receive only a one-way SHA-256 fingerprint, never the record itself. Blockstream supplies the public Bitcoin block data used to check a stamp.</li>
</ul>
<p>We also download public phishing, sanctions, and price lists (for example, from GitHub and CoinPaprika); those requests carry nothing about you. These providers have their own privacy practices; we are not responsible for their handling of data.</p>

<h2>11. Data Retention</h2>
<p>We retain data for as long as needed to provide the Service, to comply with legal obligations (including tax-record retention, typically 7+ years), and to resolve disputes and enforce our agreements. You may request deletion of your account and data at any time, subject to those legal retention requirements. Deletion is permanent and unrecoverable.</p>

<h2>12. Security</h2>
<p>We use industry-standard measures including HTTPS/TLS 1.3 in transit, AES-256 encryption at rest for sensitive data, role-based access control, and breach-response protocols. However, no system is fully secure, and we cannot guarantee absolute protection against all attacks or breaches.</p>

<h2>13. Legal Requests and Law Enforcement</h2>
<p>We may disclose data only when required by valid legal process (such as a subpoena or court order) or to investigate fraud or abuse with proper legal authority. <strong>We do not share data with law enforcement absent valid legal process, and chain-analysis firms receive nothing from us beyond the address checks described below.</strong> Where legally permitted, we will notify you of legal requests for your data. We do not honor informal requests.</p>
<p><strong>Address and link checks.</strong> When you, or anyone using our checkers, asks us to check an address or link, and when we screen wallet addresses that appear in email sent to or from our own inboxes, our servers send that address or link to the screening services in Section 10. They include services run by the chain-analysis firms Chainalysis and TRM Labs (which runs Chainabuse). A check carries the address or link (and, for some services, which blockchain it is on) and nothing else about you: not your name, email, account ID, or IP address. The one thing we submit is a scan request: if VirusTotal has never seen a link being checked, we ask it to scan that link, and VirusTotal may keep and share it (Section 10). We do not file scam or fraud reports about anyone, with these services or with anyone else.</p>

<h2>14. International Data Transfers</h2>
<p>Your data may be processed and stored in the United States or other countries. By using the Service, you consent to such transfer and processing, subject to applicable data-protection law.</p>

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

<p><strong>Principio fundamental — aislamiento de inquilinos.</strong> Almstins opera bajo un estricto aislamiento de inquilinos. Sus datos le pertenecen a usted, están segregados de los de cualquier otro usuario, ningún operador puede acceder a ellos, y nunca se utilizan para ningún propósito distinto al de prestarle el Servicio.</p>

<h2>2. Nuestra Arquitectura de Privacidad (Garantías Vinculantes)</h2>
<p>Estos son compromisos arquitectónicos que fundamentan cada sección a continuación:</p>

<ul>
  <li><strong>Sin atribución.</strong> Nunca vinculamos una dirección de blockchain con una identidad legal. No realizamos KYC, verificación de identidad, agrupación de direcciones ni desanonimización, y no construimos ningún directorio de dirección-a-identidad.</li>
  <li><strong>Aislamiento de inquilinos.</strong> Cada registro está limitado a su cuenta. Ningún usuario —ni ningún operador de marca blanca— puede acceder a los datos de otro inquilino.</li>
  <li><strong>Sin vigilancia.</strong> No rastreamos su comportamiento fuera de la plataforma ni monitoreamos proactivamente direcciones de blockchain de terceros. La única excepción: revisamos las direcciones de wallet que aparecen en los correos enviados a nuestros propios buzones o desde ellos, en busca de señales de estafa y de sanciones (Sección 10). Usted proporciona las direcciones y los registros que desea organizar.</li>
  <li><strong>Solo lectura, sin custodia.</strong> Nunca custodiamos claves ni movemos fondos, por lo que nunca poseemos las credenciales que harían que sus activos fueran accesibles a través de nosotros.</li>
</ul>

<h2>3. Información que Recopilamos</h2>

<h3>3.1 Información que usted proporciona directamente</h3>
<ul>
  <li><strong>Información de cuenta:</strong> su correo electrónico y nivel de suscripción. <strong>No recopilamos ni almacenamos su nombre</strong> — un nombre proporcionado por un proveedor OAuth es descartado, y el registro por correo electrónico y contraseña solicita únicamente el correo electrónico. (Stripe puede conservar un nombre de facturación si usted se suscribe.)</li>
  <li><strong>Datos de criptomonedas:</strong> direcciones de wallet que usted suministra, historial público en cadena de esas direcciones y registros de transacciones.</li>
  <li><strong>Datos financieros:</strong> archivos CSV de exchanges que usted importa, montos de transacciones, base de costo y ganancias/pérdidas.</li>
  <li><strong>Archivos adjuntos de documentos:</strong> imágenes de recibos, PDFs y documentos de respaldo que usted sube.</li>
  <li><strong>Contenido Comunitario (si usa funciones comunitarias):</strong> marcadores de fraude, reclamaciones de direcciones y reseñas estructuradas que usted envía. Véase la Sección 6.</li>
  <li><strong>Comunicaciones:</strong> tickets de soporte, comentarios e informes de errores.</li>
</ul>

<h3>3.2 Información recopilada automáticamente</h3>
<ul>
  <li><strong>Datos de uso:</strong> páginas visitadas, funciones utilizadas, duración de la sesión.</li>
  <li><strong>Información del dispositivo:</strong> tipo de navegador, sistema operativo y dirección IP (esta última también se utiliza para controles de sanciones y geolocalización).</li>
  <li><strong>Datos de registro:</strong> marcas de tiempo de acciones, registros de errores, llamadas a la API.</li>
  <li><strong>Analíticas:</strong> patrones de uso agregados y no identificativos (véase la Sección 9, Cookies &amp; Analytics).</li>
</ul>

<h3>3.3 Información que NO recopilamos</h3>
<ul>
  <li>Claves privadas ni seed phrases (nunca las solicitamos).</li>
  <li>Claves API de exchanges ni contraseñas (los datos se importan mediante CSV o mediante capturas de pantalla que usted sube, o se leen por dirección pública).</li>
  <li>Identificadores biométricos ni documentos de identidad gubernamentales.</li>
  <li>Datos de vinculación de identidad — no realizamos KYC.</li>
  <li>Números de cuentas bancarias ni números de tarjetas de crédito/débito. Nunca los solicitamos, y los datos de tarjetas para la facturación son gestionados exclusivamente por Stripe. Si una captura de pantalla o un recibo que usted sube muestra alguno, forma parte de esa imagen: conservamos las imágenes que usted guarda en su cuenta (Sección 3.1) y enviamos a Anthropic las capturas que usted nos pide leer (Sección 8).</li>
</ul>

<h2>4. Cómo Utilizamos la Información</h2>
<p>Utilizamos la información únicamente para:</p>
<ul>
  <li>Prestarle el Servicio (p. ej., calcular la base de costo, mostrar su panel de control, generar informes, ejecutar verificaciones de seguridad que usted solicite).</li>
  <li>Autenticar su cuenta y prevenir el acceso no autorizado, el fraude y el abuso.</li>
  <li>Revisar las direcciones de wallet que aparecen en los correos enviados a nuestros propios buzones o desde ellos, en busca de señales de estafa y de sanciones (Sección 10).</li>
  <li>Operar las funciones de seguridad comunitaria de forma anónima y agregada (Sección 6).</li>
  <li>Responder a sus solicitudes de soporte.</li>
  <li>Mejorar el Servicio mediante analíticas agregadas y no identificativas.</li>
  <li>Cumplir con las obligaciones legales y los procesos legales válidos.</li>
</ul>

<p><strong>Nunca</strong> utilizamos su información para publicidad, elaboración de perfiles, marketing dirigido, entrenamiento de modelos o venta, y nunca la compartimos con terceros para sus propios fines comerciales.</p>

<h2>5. Manejo de Direcciones de Blockchain</h2>
<ul>
  <li><strong>Qué recopilamos:</strong> las direcciones que usted ingresa, las direcciones extraídas de los CSVs que importa, y las direcciones observadas en los datos públicos en cadena de las wallets que agrega. Las direcciones de contrapartes pueden añadirse automáticamente a su libreta de direcciones privada para ayudarle a organizar las transacciones.</li>
  <li><strong>Las etiquetas son privadas.</strong> Cualquier etiqueta que aplique (p. ej., "Café de Juan") reside únicamente en su cuenta y nunca se publica ni se comparte entre inquilinos.</li>
  <li><strong>Sin atribución.</strong> Nunca asociamos una dirección con una persona ni construimos un mapa público de dirección-a-identidad. Cuando usted utiliza sus propios registros para acreditar su propia titularidad, eso constituye una divulgación voluntaria de su parte — no algo que realizamos sobre usted ni sobre terceros.</li>
  <li><strong>Retención/eliminación:</strong> las direcciones se conservan mientras sean necesarias para prestar el Servicio y de conformidad con los requisitos legales de retención; usted puede eliminarlas conforme a la Sección 8.</li>
  <li><strong>Almstins Verify — Destinos registrados:</strong> si usa Almstins Verify, almacenamos los Destinos de pago que usted registra (direcciones de recepción, códigos QR o enlaces) y los <strong>artefactos de prueba de titularidad</strong> que proporciona (p. ej., una firma o un registro de dominio). Estos datos son suyos, se conservan bajo aislamiento de inquilinos y se utilizan <strong>únicamente</strong> para supervisar esos Destinos y alertarle de cambios. Los escaneos de QR mediante cámara (B.5.6 del Acuerdo de Usuario) se <strong>decodifican en el dispositivo</strong> — recibimos únicamente la cadena de destino decodificada, nunca la imagen. <strong>No</strong> vinculamos sus Destinos con sus clientes y <strong>no</strong> supervisamos a terceros. Un Destino que usted registra se vincula <strong>únicamente a su propia cuenta (su correo electrónico), de forma privada y bajo aislamiento de inquilinos</strong> — nunca se muestra a otros usuarios ni al público, y nunca se utiliza para identificarle. Esto es su auto-asociación voluntaria de su propio Destino; no es atribución de ningún tercero, y seguimos sin realizar KYC y sin construir ningún mapa público o entre inquilinos de dirección-a-identidad.</li>
  <li><strong>Almstins Verified Entity — verificación pública de direcciones (B.8):</strong> si opera una Verified Entity (un exchange, negocio, institución u otra organización), puede registrar un dominio que controla y publicar, en ese dominio, las direcciones de recepción que declara como propias. Aquí, <strong>por diseño y por su elección, las direcciones verificadas y el dominio que las publicó se muestran públicamente</strong> — para que cualquiera pueda comprobar una dirección antes de pagarla. Esto es la <strong>autodivulgación voluntaria de su organización sobre sus propias direcciones</strong>, no una atribución que nosotros realicemos. Confirmamos el control mediante <strong>Domain Attestation</strong> (un desafío emitido por Almstins que usted coloca en su propio dominio) y una firma opcional por dirección; luego <strong>leemos, almacenamos en caché y reflejamos</strong> lo que su dominio publica — su registro publicado es la fuente de verdad. <strong>La identidad de su cuenta (correo electrónico), los artefactos de prueba y el vínculo entre su cuenta y su dominio permanecen privados y bajo aislamiento de inquilinos</strong>, nunca se muestran. Seguimos sin vincular <strong>nunca</strong> la dirección de un <strong>tercero</strong> con una identidad, sin realizar KYC y sin construir ningún directorio público o entre inquilinos de dirección-a-identidad para quien no haya demostrado el control por sí mismo. No usamos las consultas públicas de verificación para perfilar a quién consulta. Puede revocar una dirección en cualquier momento eliminándola de su registro publicado. Se aplica cuando y donde se ofrezca esta Superficie.</li>
</ul>

<h2>6. Funciones de Seguridad Comunitaria (Marcadores, Reseñas, Reclamaciones, Insignias)</h2>
<p><em>Aplicable cuando y donde estas funciones estén disponibles.</em></p>
<ul>
  <li><strong>Qué se almacena:</strong> el marcador de fraude, la reseña estructurada o la reclamación, vinculados a una <strong>dirección</strong> de blockchain — no a una persona.</li>
  <li><strong>Las reseñas</strong> son únicamente selecciones predefinidas (sin texto libre ni calificaciones por estrellas); solo se muestran <strong>totales agregados</strong>, nunca una reseña individual ni la identidad del evaluador.</li>
  <li><strong>La identidad del denunciante/reclamante</strong> se almacena exclusivamente para la prevención de abusos y la limitación de frecuencia, y <strong>nunca se muestra</strong> ni se vincula a una persona de manera pública o ante otros inquilinos.</li>
  <li><strong>Validación:</strong> las señales de fraude publicadas son filtradas por un tercero independiente (p. ej., GoPlus); no publicamos el número de usuarios.</li>
  <li><strong>Reclamaciones y prueba de control:</strong> si usted reclama una dirección, cualquier paso de prueba de control (p. ej., una firma que usted genera en su propia wallet y nos proporciona) se utiliza únicamente para verificar el control; <strong>nunca le pedimos que conecte una wallet ni que proporcione claves.</strong></li>
  <li><strong>Correcciones</strong> se gestionan mediante la revalidación con la fuente independiente, sin revelar quién contribuyó una señal.</li>
</ul>

<h2>7. Verificación de Comerciantes y Funciones de Cámara</h2>
<p><em>Aplicable al nivel de comerciante opcional, cuando esté disponible.</em></p>
<ul>
  <li><strong>Los escaneos puntuales</strong> (QR/dirección) se decodifican <strong>en el dispositivo</strong>; ninguna imagen es almacenada ni transmitida por esa acción.</li>
  <li><strong>La monitorización continua/permanente por cámara</strong>, si es habilitada por un comerciante, puede capturar a terceros (transeúntes, empleados, clientes). <strong>El comerciante es el responsable del tratamiento de dicha captura</strong> y es responsable de obtener los consentimientos requeridos, publicar avisos y respetar los límites de retención conforme a las leyes aplicables en materia biométrica, de vigilancia, de consentimiento de dos partes y de monitorización de empleados. Almstins no solicita ni utiliza dichas grabaciones para identificar a individuos.</li>
</ul>

<h2>8. Funciones de IA</h2>
<p>Las funciones opcionales de IA envían datos a nuestro proveedor de IA, <strong>Anthropic (Claude)</strong>, únicamente cuando usted las utiliza:</p>
<ul>
  <li><strong>Lectura de capturas de pantalla:</strong> cuando usted usa "Escanear captura" (etiquetas de direcciones), "Importar captura" o "Analizar e importar" (capturas guardadas en la página de Transacciones), se envía la imagen completa para que Claude lea la dirección de wallet o la transacción que contiene. Todo lo que aparezca en ella, como nombres, montos y datos de cuentas, también se envía, por lo que le recomendamos recortar la imagen para excluir lo que prefiera no compartir. A diferencia de los escaneos de QR con la cámara (Secciones 5 y 7), que se decodifican en su dispositivo, estas imágenes salen de su dispositivo.</li>
  <li><strong>Clasificación de transacciones</strong> (planes de pago): para cada transacción sin resolver, su sentido (entrada o salida), activo, monto, valor en USD, tipo, descripción, origen, fecha, y sus propias notas y categoría.</li>
  <li><strong>Validación de recibos</strong> (planes de pago): la imagen del recibo que usted adjunta. Los PDFs no se envían.</li>
</ul>
<p>Los resultados no son vinculantes. Las direcciones leídas en una captura se colocan en el formulario para que usted las revise antes de guardarlas. Una transacción leída en una captura se guarda de inmediato en sus registros; revísela y elimine esa importación si es incorrecta. La clasificación asigna una categoría y una nota a las transacciones que considera claramente una compra, un ingreso o una transferencia entre sus propias wallets, cuando aún no tienen categoría, y deja el resto para usted; usted puede cambiar cualquiera de ellas. Los resultados de la validación de recibos son sugerencias que usted revisa.</p>

<h2>9. Cookies y Analytics</h2>
<p>Utilizamos cookies y tecnologías similares para la funcionalidad esencial y para las analíticas agregadas a través de <strong>Google Analytics</strong>. Cuando sea requerido, presentamos un mecanismo de consentimiento y respetamos sus elecciones.</p>

<h2>10. Servicios de Terceros</h2>
<p>Compartimos el mínimo de datos necesario con los proveedores de servicios que se indican a continuación, agrupados por finalidad. Cuando resulta pertinente, indicamos qué recibe cada uno.</p>
<ul>
  <li><strong>Inicio de sesión:</strong> <strong>Google</strong> y <strong>GitHub</strong>, solo si usted elige iniciar sesión con ellos. Nos facilitan su correo electrónico y su perfil básico, y saben que usted inició sesión en Almstins.</li>
  <li><strong>Facturación:</strong> <strong>Stripe</strong> recibe su correo electrónico, su plan y un identificador interno de cuenta. Usted introduce los datos de su tarjeta directamente en Stripe, un proveedor PCI-DSS Level 1; nosotros nunca los vemos.</li>
  <li><strong>Alojamiento y base de datos:</strong> <strong>Render</strong> aloja el Servicio, nuestra base de datos Postgres y nuestros registros (logs) del servidor. Render distribuye el sitio a través de la red de <strong>Cloudflare</strong>, que ve cada solicitud y su dirección IP.</li>
  <li><strong>Correo electrónico:</strong> un proveedor de <strong>correo electrónico/SMTP</strong> (enlaces de inicio de sesión, verificación, correos de bienvenida, de alerta y de cuenta, y los mensajes que usted nos solicita enviar a una contraparte), <strong>Resend</strong> (correos de introducción tras registrarse o registrar su primer destino en Verify) y los proveedores que alojan nuestros propios buzones, incluido <strong>Google (Gmail)</strong> (mensajes de soporte, de contacto y de ayuda con la conciliación, informes de errores y avisos de nuevas altas de usuarios y de suscripciones). Cada uno recibe la dirección de correo electrónico del destinatario y el mensaje.</li>
  <li><strong>Analíticas:</strong> <strong>Google Analytics</strong> (las páginas que visita, un identificador de cookie, datos de su navegador y su dirección IP) e <strong>IPinfo</strong> (su dirección IP, para determinar su país; de esa consulta solo conservamos el país, archivado bajo un hash unidireccional de la IP). Algunas páginas también cargan fuentes, íconos o imágenes directamente desde <strong>Google Fonts</strong>, el servicio de íconos de Google, <strong>jsDelivr</strong> y servidores de imágenes, que ven su dirección IP y su navegador como cualquier sitio web. Por los íconos que solicita una página, esos servicios pueden saber qué exchanges o tokens aparecen en su cuenta.</li>
  <li><strong>Datos de blockchain:</strong> <strong>Alchemy, Etherscan, Routescan/Snowtrace</strong> (Avalanche), <strong>Blockstream</strong> (Bitcoin), <strong>litecoinspace.org</strong> (Litecoin), un proveedor RPC de <strong>Solana</strong>, <strong>Mysten Labs</strong> (Sui), el nodo público de <strong>Rootstock</strong>, <strong>Sovryn</strong> y <strong>The Graph</strong> (subgraphs), y la API de <strong>Aave</strong>. Reciben las direcciones de wallet públicas y los identificadores de transacción que necesitamos leer, nunca los datos de su cuenta.</li>
  <li><strong>Precios:</strong> <strong>CoinGecko, DefiLlama</strong> y <strong>Yahoo Finance</strong> reciben los tokens o símbolos de acciones que se deben valorar y las fechas, nunca su dirección de wallet ni los datos de su cuenta.</li>
  <li><strong>Verificaciones de seguridad:</strong> <strong>GoPlus Security, honeypot.is, Chainalysis</strong> (el servicio de control de sanciones de esa empresa), <strong>Chainabuse</strong> (operado por TRM Labs), <strong>Google Safe Browsing, VirusTotal</strong> y <strong>URLScan.io</strong> reciben la dirección o el enlace que se verifica; no añadimos nada sobre usted a una verificación. En el caso de un enlace, GoPlus, Google Safe Browsing y VirusTotal reciben el enlace completo, incluido todo lo que sigue al dominio, mientras que URLScan.io recibe solo el dominio. Si VirusTotal nunca ha visto un enlace, le pedimos que lo analice, y VirusTotal puede conservar los enlaces enviados y compartirlos con su comunidad de seguridad. Evite verificar enlaces que contengan códigos de acceso privados o datos personales, incluidos los enlaces privados que alguien le haya enviado. Aplicamos las mismas verificaciones de direcciones a las direcciones de wallet que aparecen en los correos enviados a nuestros propios buzones o desde ellos. La Sección 13 amplía la información sobre los servicios operados por empresas de análisis de blockchain.</li>
  <li><strong>IA:</strong> <strong>Anthropic</strong> recibe lo que envían las funciones de IA descritas en la Sección 8, solo cuando usted las utiliza.</li>
  <li><strong>Sellado de tiempo:</strong> los servidores de calendario de <strong>OpenTimestamps</strong> (operados por OpenTimestamps, Eternity Wall y Catallaxy) reciben solo una huella SHA-256 unidireccional, nunca el registro en sí. Blockstream proporciona los datos públicos de bloques de Bitcoin que se usan para comprobar un sello.</li>
</ul>
<p>También descargamos listas públicas de phishing, de sanciones y de precios (por ejemplo, de GitHub y CoinPaprika); esas solicitudes no contienen nada sobre usted. Estos proveedores tienen sus propias prácticas de privacidad; no somos responsables de su manejo de los datos.</p>

<h2>11. Retención de Datos</h2>
<p>Conservamos los datos durante el tiempo necesario para prestar el Servicio, cumplir con las obligaciones legales (incluida la retención de registros fiscales, típicamente 7 años o más) y resolver disputas y hacer cumplir nuestros acuerdos. Usted puede solicitar la eliminación de su cuenta y sus datos en cualquier momento, sujeto a esos requisitos legales de retención. La eliminación es permanente e irrecuperable.</p>

<h2>12. Seguridad</h2>
<p>Empleamos medidas estándar del sector, incluyendo HTTPS/TLS 1.3 en tránsito, cifrado AES-256 en reposo de datos sensibles, control de acceso basado en roles y protocolos de respuesta ante brechas. Sin embargo, ningún sistema es completamente seguro, y no podemos garantizar protección absoluta contra todos los ataques o brechas.</p>

<h2>13. Solicitudes Legales y Fuerzas del Orden</h2>
<p>Podemos divulgar datos únicamente cuando lo exija un proceso legal válido (como una citación judicial u orden de un tribunal) o para investigar fraude o abuso con la debida autoridad legal. <strong>No compartimos datos con las fuerzas del orden sin un proceso legal válido, y las empresas de análisis de blockchain no reciben de nosotros nada más que las verificaciones de direcciones descritas a continuación.</strong> En la medida en que lo permita la ley, le notificaremos las solicitudes legales relativas a sus datos. No atendemos solicitudes informales.</p>
<p><strong>Verificaciones de direcciones y enlaces.</strong> Cuando usted, o cualquier persona que utilice nuestros verificadores, nos pide verificar una dirección o un enlace, y cuando revisamos las direcciones de wallet que aparecen en los correos enviados a nuestros propios buzones o desde ellos, nuestros servidores envían esa dirección o ese enlace a los servicios de verificación indicados en la Sección 10. Entre ellos hay servicios operados por las empresas de análisis de blockchain Chainalysis y TRM Labs (que opera Chainabuse). Una verificación incluye la dirección o el enlace (y, para algunos servicios, la blockchain a la que pertenece) y nada más sobre usted: ni su nombre, ni su correo electrónico, ni el identificador de su cuenta, ni su dirección IP. Lo único que enviamos para análisis es una solicitud de escaneo: si VirusTotal nunca ha visto un enlace que se verifica, le pedimos que lo analice, y VirusTotal puede conservarlo y compartirlo (Sección 10). No enviamos informes de estafa o fraude sobre nadie, ni a estos servicios ni a ningún otro destinatario, y no presentamos denuncias ante las fuerzas del orden.</p>

<h2>14. Transferencias Internacionales de Datos</h2>
<p>Sus datos pueden ser procesados y almacenados en los Estados Unidos u otros países. Al utilizar el Servicio, usted consiente dicha transferencia y procesamiento, sujeto a la legislación aplicable en materia de protección de datos.</p>

<h2>15. Privacidad de Menores</h2>
<p>El Servicio está destinado a usuarios mayores de 18 años. No recopilamos datos de menores de forma consciente y eliminaremos dichos datos si los descubrimos.</p>

<h2>16. Sus Derechos</h2>
<p>Sujeto a la legislación aplicable (incluidos GDPR y CCPA), usted puede:</p>
<ul>
  <li><strong>Acceder</strong> a una copia de los datos que conservamos sobre usted;</li>
  <li><strong>Corregir</strong> datos inexactos;</li>
  <li><strong>Eliminar</strong> su cuenta y sus datos (sujeto a retenciones legales);</li>
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

<p><strong>Principe fondamental — isolation des locataires.</strong> Almstins fonctionne selon une stricte isolation des locataires. Vos données vous appartiennent, sont séparées de celles de tout autre utilisateur, ne sont jamais accessibles aux opérateurs, et ne sont jamais utilisées à d'autres fins que la fourniture du Service.</p>

<h2>2. Notre Architecture de Confidentialité (Garanties Contraignantes)</h2>
<p>Il s'agit d'engagements architecturaux qui fondent chaque section ci-dessous :</p>

<ul>
  <li><strong>Pas d'attribution.</strong> Nous ne lions jamais une adresse blockchain à une identité légale. Nous n'effectuons pas de KYC, de vérification d'identité, de regroupement d'adresses ni de désanonymisation, et nous ne constituons aucun répertoire adresse-vers-identité.</li>
  <li><strong>Isolation des locataires.</strong> Chaque enregistrement est limité à votre compte. Aucun utilisateur — et aucun opérateur en marque blanche — ne peut accéder aux données d'un autre locataire.</li>
  <li><strong>Pas de surveillance.</strong> Nous ne suivons pas votre comportement hors de la plateforme et ne surveillons pas proactivement les adresses blockchain de tiers. Seule exception : nous contrôlons les adresses de wallet qui figurent dans les e-mails envoyés à nos propres boîtes de réception ou depuis celles-ci, afin d'y détecter des signes d'arnaque ou de sanctions (Section 10). Vous fournissez les adresses et les enregistrements que vous souhaitez organiser.</li>
  <li><strong>Lecture seule, sans garde.</strong> Nous ne détenons jamais de clés et ne déplaçons jamais de fonds, de sorte que nous ne possédons jamais les identifiants qui rendraient vos actifs accessibles via nous.</li>
</ul>

<h2>3. Informations que Nous Collectons</h2>

<h3>3.1 Informations que vous fournissez directement</h3>
<ul>
  <li><strong>Informations de compte :</strong> votre adresse e-mail et votre niveau d'abonnement. <strong>Nous ne collectons ni ne stockons votre nom</strong> — un nom fourni par un fournisseur OAuth est ignoré, et l'inscription par e-mail et mot de passe ne demande qu'un e-mail. (Stripe peut conserver un nom de facturation si vous vous abonnez.)</li>
  <li><strong>Données de cryptomonnaies :</strong> les adresses de wallet que vous fournissez, l'historique public sur la chaîne pour ces adresses, et les enregistrements de transactions.</li>
  <li><strong>Données financières :</strong> les CSV d'exchanges que vous importez, les montants de transactions, la base de coût et les gains/pertes.</li>
  <li><strong>Pièces jointes de documents :</strong> les images de reçus, les PDFs et les documents justificatifs que vous téléversez.</li>
  <li><strong>Contenu Communautaire (si vous utilisez les fonctionnalités communautaires) :</strong> les signalements de fraude, les revendications d'adresses et les avis structurés que vous soumettez. Voir la Section 6.</li>
  <li><strong>Communications :</strong> tickets de support, retours et rapports d'erreurs.</li>
</ul>

<h3>3.2 Informations collectées automatiquement</h3>
<ul>
  <li><strong>Données d'utilisation :</strong> pages visitées, fonctionnalités utilisées, durée de la session.</li>
  <li><strong>Informations sur l'appareil :</strong> type de navigateur, système d'exploitation et adresse IP (cette dernière est également utilisée pour les contrôles de sanctions et de géolocalisation).</li>
  <li><strong>Données de journalisation :</strong> horodatages des actions, journaux d'erreurs, appels API.</li>
  <li><strong>Analytique :</strong> modèles d'utilisation agrégés et non identifiants (voir la Section 9, Cookies &amp; Analytics).</li>
</ul>

<h3>3.3 Informations que nous ne collectons PAS</h3>
<ul>
  <li>Clés privées ou seed phrases (nous ne les demandons jamais).</li>
  <li>Clés API d'exchanges ni mots de passe (les données sont importées via CSV ou via des captures d'écran que vous téléversez, ou lues par adresse publique).</li>
  <li>Identifiants biométriques ou pièces d'identité gouvernementales.</li>
  <li>Données de liaison d'identité — nous n'effectuons pas de KYC.</li>
  <li>Numéros de comptes bancaires ou de cartes de crédit/débit. Nous ne les demandons jamais, et les données de carte servant à la facturation sont traitées exclusivement par Stripe. Si une capture d'écran ou un reçu que vous téléversez en affiche un, il fait partie de cette image : nous conservons les images que vous enregistrez dans votre compte (Section 3.1) et transmettons à Anthropic les captures que vous nous demandez de lire (Section 8).</li>
</ul>

<h2>4. Comment Nous Utilisons les Informations</h2>
<p>Nous utilisons les informations uniquement pour :</p>
<ul>
  <li>Vous fournir le Service (p. ex., calculer la base de coût, afficher votre tableau de bord, générer des rapports, effectuer les vérifications de sécurité que vous demandez).</li>
  <li>Authentifier votre compte et prévenir les accès non autorisés, la fraude et les abus.</li>
  <li>Contrôler les adresses de wallet qui figurent dans les e-mails envoyés à nos propres boîtes de réception ou depuis celles-ci, afin d'y détecter des signes d'arnaque ou de sanctions (Section 10).</li>
  <li>Faire fonctionner les fonctionnalités de sécurité communautaire de manière anonymisée et agrégée (Section 6).</li>
  <li>Répondre à vos demandes de support.</li>
  <li>Améliorer le Service grâce à des analyses agrégées et non identifiantes.</li>
  <li>Respecter les obligations légales et les procédures judiciaires valides.</li>
</ul>

<p><strong>Nous n'utilisons jamais</strong> vos informations à des fins de publicité, de profilage, de marketing ciblé, d'entraînement de modèles ou de vente, et nous ne les partageons jamais avec des tiers à leurs propres fins commerciales.</p>

<h2>5. Traitement des Adresses Blockchain</h2>
<ul>
  <li><strong>Ce que nous collectons :</strong> les adresses que vous saisissez, les adresses extraites de vos CSV importés, et les adresses observées dans les données publiques sur la chaîne pour les wallets que vous ajoutez. Les adresses de contreparties peuvent être automatiquement ajoutées à votre carnet d'adresses privé pour vous aider à organiser vos transactions.</li>
  <li><strong>Les étiquettes sont privées.</strong> Toute étiquette que vous appliquez (p. ex., « Café de Jean ») ne réside que dans votre compte et n'est jamais publiée ni partagée entre locataires.</li>
  <li><strong>Pas d'attribution.</strong> Nous n'associons jamais une adresse à une personne et ne constituons pas de carte publique adresse-vers-identité. Lorsque vous utilisez vos propres enregistrements pour prouver votre propre propriété, il s'agit de votre divulgation volontaire — et non de quelque chose que nous effectuons sur vous ou sur d'autres.</li>
  <li><strong>Conservation/suppression :</strong> les adresses sont conservées aussi longtemps que nécessaire pour fournir le Service et conformément aux exigences légales de conservation ; vous pouvez les supprimer conformément à la Section 8.</li>
  <li><strong>Almstins Verify — Destinations enregistrées :</strong> si vous utilisez Almstins Verify, nous stockons les Destinations de paiement que vous enregistrez (adresses de réception, codes QR ou liens) ainsi que les <strong>artefacts de preuve de propriété</strong> que vous fournissez (p. ex., une signature ou un enregistrement de domaine). Ces données vous appartiennent, sont conservées sous isolation des locataires et utilisées <strong>uniquement</strong> pour surveiller ces Destinations et vous alerter en cas de changement. Les scans de QR par caméra (B.5.6 de l'Accord d'utilisateur) sont <strong>décodés sur l'appareil</strong> — nous ne recevons que la chaîne de destination décodée, jamais l'image. Nous <strong>ne</strong> relions <strong>pas</strong> vos Destinations à vos clients et <strong>ne</strong> surveillons <strong>pas</strong> de tiers. Une Destination que vous enregistrez est liée <strong>uniquement à votre propre compte (votre e-mail), de manière privée et sous isolation des locataires</strong> — jamais montrée à d'autres utilisateurs ni au public, et jamais utilisée pour vous identifier. Il s'agit de votre auto-association volontaire de votre propre Destination ; ce n'est pas l'attribution d'un tiers, et nous n'effectuons toujours aucun KYC et ne constituons aucune carte publique ou inter-locataires adresse-vers-identité.</li>
  <li><strong>Almstins Verified Entity — vérification publique des adresses (B.8) :</strong> si vous exploitez une Verified Entity (un exchange, une entreprise, une institution ou une autre organisation), vous pouvez enregistrer un domaine que vous contrôlez et publier, sur ce domaine, les adresses de réception que vous déclarez comme étant les vôtres. Ici, <strong>par conception et selon votre choix, les adresses vérifiées et le domaine qui les a publiées sont affichés publiquement</strong> — afin que quiconque puisse vérifier une adresse avant de la payer. Il s'agit de l'<strong>auto-divulgation volontaire par votre organisation de ses propres adresses</strong>, et non d'une attribution que nous effectuons. Nous confirmons le contrôle par <strong>Domain Attestation</strong> (un défi émis par Almstins que vous placez sur votre propre domaine) et une signature facultative par adresse ; nous <strong>lisons, mettons en cache et reflétons</strong> ensuite ce que votre domaine publie — votre enregistrement publié fait foi. <strong>L'identité de votre compte (e-mail), les artefacts de preuve et le lien entre votre compte et votre domaine demeurent privés et sous isolation des locataires</strong>, jamais affichés. Nous ne relions toujours <strong>jamais</strong> l'adresse d'un <strong>tiers</strong> à une identité, n'effectuons aucun KYC et ne constituons aucun répertoire public ou inter-locataires adresse-vers-identité pour quiconque n'a pas lui-même prouvé le contrôle. Nous n'utilisons pas les consultations publiques de vérification pour profiler qui consulte. Vous pouvez révoquer une adresse à tout moment en la retirant de votre enregistrement publié. S'applique lorsque et là où cette Surface est proposée.</li>
</ul>

<h2>6. Fonctionnalités de Sécurité Communautaire (Signalements, Avis, Revendications, Badges)</h2>
<p><em>Applicable lorsque et où ces fonctionnalités sont proposées.</em></p>
<ul>
  <li><strong>Ce qui est stocké :</strong> le signalement de fraude, l'avis structuré ou la revendication, associés à une <strong>adresse</strong> blockchain — non à une personne.</li>
  <li><strong>Les avis</strong> sont uniquement des sélections prédéfinies (sans texte libre, sans notation par étoiles) ; seuls les <strong>totaux agrégés</strong> sont affichés, jamais un avis individuel ni l'identité de l'évaluateur.</li>
  <li><strong>L'identité du déclarant/revendicateur</strong> est stockée uniquement à des fins de prévention des abus et de limitation du débit, et n'est <strong>jamais affichée</strong> ni associée à une personne publiquement ou auprès d'autres locataires.</li>
  <li><strong>Validation :</strong> les signaux de fraude publiés sont filtrés par un tiers indépendant (p. ex., GoPlus) ; nous ne publions pas le nombre d'utilisateurs.</li>
  <li><strong>Revendications et preuve de contrôle :</strong> si vous revendiquez une adresse, toute étape de preuve de contrôle (p. ex., une signature que vous générez dans votre propre wallet et que vous nous fournissez) est utilisée uniquement pour vérifier le contrôle ; <strong>nous ne vous demandons jamais de connecter un wallet ni de fournir des clés.</strong></li>
  <li><strong>Les corrections</strong> sont gérées par revalidation auprès de la source indépendante, sans divulguer qui a contribué un signal.</li>
</ul>

<h2>7. Vérification des Commerçants et Fonctionnalités de Caméra</h2>
<p><em>Applicable au niveau commerçant optionnel, lorsqu'il est proposé.</em></p>
<ul>
  <li><strong>Les scans ponctuels</strong> (QR/adresse) sont décodés <strong>sur l'appareil</strong> ; aucune image n'est stockée ni transmise par cette action.</li>
  <li><strong>La surveillance continue par caméra</strong>, si elle est activée par un commerçant, peut capturer des tiers (passants, employés, clients). <strong>Le commerçant est le responsable du traitement de cette capture</strong> et est tenu d'obtenir les consentements requis, d'afficher des avis et de respecter les limites de conservation en vertu des lois applicables en matière biométrique, de surveillance, de consentement des deux parties et de surveillance des employés. Almstins ne demande pas et n'utilise pas ces enregistrements pour identifier des individus.</li>
</ul>

<h2>8. Fonctionnalités d'IA</h2>
<p>Les fonctionnalités d'IA optionnelles transmettent des données à notre fournisseur d'IA, <strong>Anthropic (Claude)</strong>, uniquement lorsque vous les utilisez :</p>
<ul>
  <li><strong>Lecture de captures d'écran :</strong> lorsque vous utilisez « Scanner la capture » (libellés d'adresses), « Importer une capture » ou « Analyser et importer » (captures enregistrées sur la page Transactions), l'image entière est transmise afin que Claude lise l'adresse de wallet ou la transaction qu'elle contient. Tout ce qui y est visible, comme des noms, des montants et des informations de compte, est également transmis ; recadrez donc l'image pour en exclure ce que vous préférez ne pas partager. Contrairement aux scans de QR par caméra (Sections 5 et 7), qui sont décodés sur votre appareil, ces images quittent votre appareil.</li>
  <li><strong>Classification des transactions</strong> (abonnements payants) : pour chaque transaction non résolue, son sens (entrée ou sortie), l'actif, le montant, la valeur en USD, le type, la description, la source, la date, ainsi que vos propres notes et votre catégorie.</li>
  <li><strong>Validation des reçus</strong> (abonnements payants) : l'image du reçu que vous joignez. Les PDFs ne sont pas transmis.</li>
</ul>
<p>Les résultats ne sont pas définitifs. Les adresses lues dans une capture sont placées dans le formulaire pour que vous les vérifiiez avant de les enregistrer. Une transaction lue dans une capture est enregistrée immédiatement dans vos données ; vérifiez-la et supprimez cette importation si elle est erronée. La classification attribue une catégorie et une note aux transactions qu'elle juge clairement être un achat, un revenu ou un transfert entre vos propres wallets, lorsqu'elles n'ont pas encore de catégorie, et vous laisse les autres ; vous pouvez modifier chacune d'elles. Les résultats de la validation des reçus sont des suggestions que vous examinez.</p>

<h2>9. Cookies et Analytics</h2>
<p>Nous utilisons des cookies et des technologies similaires pour les fonctionnalités essentielles et pour les analyses agrégées via <strong>Google Analytics</strong>. Lorsque cela est requis, nous présentons un mécanisme de consentement et respectons vos choix.</p>

<h2>10. Services Tiers</h2>
<p>Nous partageons le minimum de données nécessaire avec les prestataires de services ci-dessous, regroupés par finalité. Le cas échéant, nous indiquons ce que chacun reçoit.</p>
<ul>
  <li><strong>Connexion :</strong> <strong>Google</strong> et <strong>GitHub</strong>, uniquement si vous choisissez de vous connecter avec eux. Ils nous communiquent votre adresse e-mail et votre profil de base, et apprennent que vous vous êtes connecté à Almstins.</li>
  <li><strong>Facturation :</strong> <strong>Stripe</strong> reçoit votre e-mail, votre abonnement et un identifiant de compte interne. Vous saisissez vos données de carte directement auprès de Stripe, un prestataire PCI-DSS Level 1 ; nous ne les voyons jamais.</li>
  <li><strong>Hébergement et base de données :</strong> <strong>Render</strong> héberge le Service, notre base de données Postgres et nos journaux serveur. Render diffuse le site via le réseau de <strong>Cloudflare</strong>, qui voit chaque requête et votre adresse IP.</li>
  <li><strong>E-mail :</strong> un fournisseur <strong>e-mail/SMTP</strong> (liens de connexion, vérification, e-mails de bienvenue, d'alerte et de compte, et messages que vous nous demandez d'envoyer à une contrepartie), <strong>Resend</strong> (e-mails de prise en main après votre inscription ou l'enregistrement de votre première destination Verify) et les prestataires qui hébergent nos propres boîtes de réception, dont <strong>Google (Gmail)</strong> (messages de support, de contact et de demande d'aide au rapprochement, rapports d'erreurs et avis de nouvelles inscriptions et de nouveaux abonnements). Chacun reçoit l'adresse e-mail du destinataire et le message.</li>
  <li><strong>Analytique :</strong> <strong>Google Analytics</strong> (les pages que vous visitez, un identifiant de cookie, des informations sur votre navigateur et votre adresse IP) et <strong>IPinfo</strong> (votre adresse IP, pour en déterminer le pays ; de cette consultation, nous ne conservons que le pays, classé sous une empreinte à sens unique de l'adresse IP). Certaines pages chargent aussi des polices, des icônes ou des images directement depuis <strong>Google Fonts</strong>, le service d'icônes de Google, <strong>jsDelivr</strong> et des hébergeurs d'images, qui voient votre adresse IP et votre navigateur comme tout site web. À partir des icônes qu'une page demande, ces services peuvent savoir quels exchanges ou tokens figurent dans votre compte.</li>
  <li><strong>Données blockchain :</strong> <strong>Alchemy, Etherscan, Routescan/Snowtrace</strong> (Avalanche), <strong>Blockstream</strong> (Bitcoin), <strong>litecoinspace.org</strong> (Litecoin), un fournisseur RPC <strong>Solana</strong>, <strong>Mysten Labs</strong> (Sui), le nœud public <strong>Rootstock</strong>, <strong>Sovryn</strong> et <strong>The Graph</strong> (subgraphs), ainsi que l'API <strong>Aave</strong>. Ils reçoivent les adresses de wallet publiques et les identifiants de transaction que nous devons lire, jamais les informations de votre compte.</li>
  <li><strong>Cours :</strong> <strong>CoinGecko, DefiLlama</strong> et <strong>Yahoo Finance</strong> reçoivent les tokens ou les symboles boursiers à valoriser et les dates, jamais votre adresse de wallet ni les informations de votre compte.</li>
  <li><strong>Vérifications de sécurité :</strong> <strong>GoPlus Security, honeypot.is, Chainalysis</strong> (son service de criblage des sanctions), <strong>Chainabuse</strong> (exploité par TRM Labs), <strong>Google Safe Browsing, VirusTotal</strong> et <strong>URLScan.io</strong> reçoivent l'adresse ou le lien vérifié ; nous n'ajoutons rien vous concernant à une vérification. Pour un lien, GoPlus, Google Safe Browsing et VirusTotal reçoivent le lien complet, y compris tout ce qui suit le domaine, tandis qu'URLScan.io ne reçoit que le domaine. Si VirusTotal n'a jamais vu un lien, nous lui demandons de l'analyser, et VirusTotal peut conserver les liens soumis et les partager avec sa communauté de sécurité. Évitez de vérifier des liens contenant des codes d'accès privés ou des données personnelles, y compris des liens privés que quelqu'un vous a envoyés. Nous appliquons les mêmes vérifications d'adresses aux adresses de wallet qui figurent dans les e-mails envoyés à nos propres boîtes de réception ou depuis celles-ci. La Section 13 en dit plus sur les services exploités par des sociétés d'analyse de blockchain.</li>
  <li><strong>IA :</strong> <strong>Anthropic</strong> reçoit ce que transmettent les fonctionnalités d'IA décrites à la Section 8, uniquement lorsque vous les utilisez.</li>
  <li><strong>Horodatage :</strong> les serveurs de calendrier <strong>OpenTimestamps</strong> (exploités par OpenTimestamps, Eternity Wall et Catallaxy) ne reçoivent qu'une empreinte SHA-256 à sens unique, jamais l'enregistrement lui-même. Blockstream fournit les données publiques de blocs Bitcoin utilisées pour vérifier un horodatage.</li>
</ul>
<p>Nous téléchargeons aussi des listes publiques d'hameçonnage, de sanctions et de cours (par exemple depuis GitHub et CoinPaprika) ; ces requêtes ne contiennent rien vous concernant. Ces prestataires ont leurs propres pratiques en matière de confidentialité ; nous ne sommes pas responsables de leur traitement des données.</p>

<h2>11. Conservation des Données</h2>
<p>Nous conservons les données aussi longtemps que nécessaire pour fournir le Service, respecter les obligations légales (y compris la conservation des dossiers fiscaux, généralement 7 ans ou plus) et résoudre les litiges et faire respecter nos accords. Vous pouvez demander la suppression de votre compte et de vos données à tout moment, sous réserve de ces exigences légales de conservation. La suppression est permanente et irrécupérable.</p>

<h2>12. Sécurité</h2>
<p>Nous appliquons des mesures conformes aux normes du secteur, notamment HTTPS/TLS 1.3 en transit, le chiffrement AES-256 au repos des données sensibles, le contrôle d'accès basé sur les rôles et des protocoles de réponse aux violations. Cependant, aucun système n'est entièrement sécurisé et nous ne pouvons garantir une protection absolue contre toutes les attaques ou violations.</p>

<h2>13. Demandes Légales et Forces de l'Ordre</h2>
<p>Nous ne pouvons divulguer des données que si cela est exigé par une procédure judiciaire valide (telle qu'une citation à comparaître ou une ordonnance du tribunal) ou pour enquêter sur une fraude ou un abus avec l'autorité légale appropriée. <strong>Nous ne partageons pas de données avec les forces de l'ordre sans procédure judiciaire valide, et les sociétés d'analyse de blockchain ne reçoivent de notre part rien d'autre que les vérifications d'adresses décrites ci-dessous.</strong> Dans la mesure où la loi le permet, nous vous informerons des demandes légales visant vos données. Nous ne donnons pas suite aux demandes informelles.</p>
<p><strong>Vérifications d'adresses et de liens.</strong> Lorsqu'une vérification d'adresse ou de lien nous est demandée, par vous ou par toute personne utilisant nos outils de vérification, et lorsque nous contrôlons les adresses de wallet qui figurent dans les e-mails envoyés à nos propres boîtes de réception ou depuis celles-ci, nos serveurs transmettent cette adresse ou ce lien aux services de vérification indiqués à la Section 10. Parmi eux figurent des services exploités par les sociétés d'analyse de blockchain Chainalysis et TRM Labs (qui exploite Chainabuse). Une vérification ne transmet que l'adresse ou le lien (et, pour certains services, la blockchain concernée), et rien d'autre vous concernant : ni votre nom, ni votre e-mail, ni l'identifiant de votre compte, ni votre adresse IP. La seule chose que nous soumettons est une demande d'analyse : si VirusTotal n'a jamais vu un lien vérifié, nous lui demandons de l'analyser, et VirusTotal peut le conserver et le partager (Section 10). Nous ne déposons aucun signalement d'arnaque ou de fraude concernant qui que ce soit, ni auprès de ces services ni auprès de quiconque.</p>

<h2>14. Transferts Internationaux de Données</h2>
<p>Vos données peuvent être traitées et stockées aux États-Unis ou dans d'autres pays. En utilisant le Service, vous consentez à ce transfert et à ce traitement, sous réserve du droit applicable en matière de protection des données.</p>

<h2>15. Confidentialité des Mineurs</h2>
<p>Le Service est destiné aux utilisateurs âgés de 18 ans et plus. Nous ne collectons pas sciemment de données auprès de mineurs et supprimerons ces données si nous les découvrons.</p>

<h2>16. Vos Droits</h2>
<p>Sous réserve du droit applicable (notamment le GDPR et le CCPA), vous pouvez :</p>
<ul>
  <li><strong>Accéder</strong> à une copie des données que nous détenons à votre sujet ;</li>
  <li><strong>Rectifier</strong> des données inexactes ;</li>
  <li><strong>Supprimer</strong> votre compte et vos données (sous réserve de conservations légales) ;</li>
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
