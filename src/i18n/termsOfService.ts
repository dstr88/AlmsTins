// Terms of Service — consolidated ToS, all user-visible copy (EN · ES · FR).
//
// Rendered by src/components/terms-of-service.astro (inline <details> on some
// pages, and as the footer "terms of service" modal via Footer.astro). The
// component receives a `lang` prop and selects the locale with getTerms(lang);
// the modal inherits whatever language the page passed to the Footer, so there
// are no per-locale routes for this surface.
//
// `body` is developer-controlled HTML rendered with set:html (legal markup with
// <strong>/<ul>/<a>, etc.). Crypto jargon (wallet, token, phishing, honeypot,
// blockchain) and all proper nouns (Almstins, Stripe, OFAC, Tennessee…) are kept
// in English per design.claude.md. ES/FR are first-pass legal copy — gate behind
// counsel + a fluent reviewer before treating as authoritative.

import type { Lang } from '@/lib/i18n/locale';

export interface TermsLocale {
  lang: Lang;
  /** <summary> toggle text for the inline <details> variant. */
  summaryLabel: string;
  /** aria-label for the footer modal dialog. */
  ariaLabel: string;
  /** Full Terms of Service body — HTML, rendered with set:html. */
  body: string;
}

export const en: TermsLocale = {
  lang: 'en',
  summaryLabel: 'Terms of Service',
  ariaLabel: 'Terms of Service',
  body: `
<h1>Terms of Service</h1>
<p><strong>Last updated: June 15, 2026</strong></p>

<p>
  Welcome to Almstins ("we", "us", "our"). These Terms govern your use of almstins.com and
  everything we offer there — the free <strong>Wallet &amp; Website Checker</strong>, the
  <strong>portfolio &amp; wallet tracker</strong>, the <strong>bookkeeping, tax-breakdown, and
  year-summary</strong> tools, any dashboard feature, and any related service (collectively, the
  "Service"). <strong>By accessing or using the Service, you agree to these Terms</strong> — whether
  or not you create an account. If you do not agree, please do not use the Service.
</p>

<h2>1. Beta Software — Independent, Read-Only, Verifiable</h2>
<p>
  Almstins is in <strong>beta</strong>. That means we are still learning what advisories need, what
  emerging-market users need, and what the next layer of security looks like. We are building this
  openly and iterating based on real feedback.
</p>
<p>
  Being in beta does not mean the code is unstable or your data is at risk. It means features may evolve,
  and we may introduce new ones based on user feedback. The core promise—read-only access, no wallet
  connection, verifiable against the chain—is architectural, not provisional.
</p>
<p>
  <strong>Verify everything against the chain.</strong> Because Almstins reads public blockchain data,
  you can cross-check every balance, every transaction, every calculation yourself. That's the point.
</p>

<h2>2. Eligibility, Sanctions &amp; Geographic Restrictions</h2>
<p>You may <strong>not</strong> use Almstins if you are:</p>
<ul>
  <li>A person, entity, or organization listed on any OFAC (Office of Foreign Assets Control) sanctions list or otherwise subject to U.S. or international economic sanctions</li>
  <li>Operating under jurisdictions that prohibit or restrict cryptocurrency use, where using Almstins would violate local law</li>
  <li>Using the Service to evade capital controls, foreign exchange restrictions, or to circumvent lawful financial reporting requirements of your jurisdiction</li>
  <li>Using the Service to facilitate money laundering, terrorist financing, fraud, or other financial crimes</li>
</ul>
<p>
  <strong>Geographic restrictions and your representation.</strong> Almstins and its affiliates do not
  offer the Service to, or conduct business with, any individual, entity, or jurisdiction restricted
  under applicable economic sanctions laws or prohibited by our payment and compliance providers.
  <strong>By accessing or using the Service, you represent and warrant that you are not located in,
  ordinarily resident in, or accessing the Service from any comprehensively sanctioned jurisdiction —
  including Cuba, Iran, North Korea, Syria, or the Crimea, Donetsk, or Luhansk regions of Ukraine.</strong>
  We may use geolocation to restrict access from these locations; this representation applies in addition
  to, and independent of, any technical control.
</p>
<p>
  If you are subject to any of these restrictions, you may not create an account or access the Service.
  Continued use in violation of this section may result in immediate termination of your account and
  reporting to appropriate authorities as required by law.
</p>

<h2>3. What Almstins Is — and Is Not</h2>
<p>
  Almstins is an <strong>investment-tracking, bookkeeping, and safety tool</strong>. It helps you see
  where your crypto holdings are and how they have moved, organize your transactions and cost basis,
  and check wallet addresses and websites before you send funds.
</p>
<p>Almstins is <strong>not</strong>:</p>
<ul>
  <li>A tax preparation service</li>
  <li>A tax advisor or accountant</li>
  <li>A financial advisor or investment advisor</li>
  <li>A legal service</li>
  <li>A certified or regulated financial product</li>
  <li>A custodian, wallet, or exchange — it never holds, moves, or has access to your funds</li>
</ul>
<p>
  Any tax-related summaries, cost-basis estimates, gain/loss figures, bookkeeping views, or safety
  results are provided for <strong>informational and organizational purposes only</strong>. They are
  not advice of any kind and are not a substitute for a qualified professional. You are solely
  responsible for your own decisions, tax filings, reporting, and compliance.
</p>

<h2>4. The Service — Specific Features</h2>

<h3>4a. Wallet &amp; Website Scam Checker</h3>
<p>
  The Checker is a <strong>free, informational</strong> tool. It queries public third-party reputation
  databases (such as GoPlus, OFAC sanctions data, honeypot.is, Chainabuse, MetaMask's phishing list,
  ScamSniffer, URLScan, and OpenPhish) and reports what they say.
</p>
<ul>
  <li><strong>Attribution, not verdict.</strong> We report what third-party databases report. We do not independently investigate, verify, or declare any address or website a scam — or safe.</li>
  <li><strong>No guarantee, either way.</strong> A "clean" or "looks safe" result means only that no source we checked has flagged it — not that it is safe. A flagged result reflects a third-party report, not our own determination. New scams appear faster than databases update.</li>
  <li><strong>No reliance.</strong> The Checker is one signal among many. <strong>You must independently verify any address or website before sending funds or connecting a wallet.</strong> We are not liable for any loss resulting from reliance on Checker results.</li>
  <li>Any community signals (flags, trust badges, reviews), where and if offered, are informational only and are <strong>not</strong> a guarantee of safety, legitimacy, or quality.</li>
</ul>

<h3>4b. Portfolio &amp; Wallet Tracker</h3>
<p>
  The tracker reads <strong>public</strong> blockchain data for wallet addresses you voluntarily provide,
  together with data you import (such as exchange CSVs and manual entries), to show balances, holdings,
  and performance over time.
</p>
<ul>
  <li><strong>Read-only, no custody, no connection.</strong> Almstins never requests your private keys, seed phrase, or any wallet connection, and never holds or moves funds. A breach of Almstins cannot move a single coin.</li>
  <li><strong>You supply the addresses.</strong> You are responsible for the wallet addresses and records you choose to track. Almstins does not link any address to your identity (see §10).</li>
  <li><strong>Accuracy depends on your inputs and on third-party data.</strong> Balances, prices, and history come from public sources and your imports and may be delayed, incomplete, or wrong. "Garbage in, garbage out": incomplete or inaccurate inputs produce unreliable figures.</li>
</ul>

<h3>4c. Bookkeeping, Tax Breakdown &amp; Year Summary</h3>
<p>
  The bookkeeping tools organize your transactions and compute informational figures — cost basis,
  realized and unrealized gains/losses, reconciliation, and a year-end summary you can hand to a
  professional.
</p>
<ul>
  <li><strong>Not tax advice.</strong> Cost-basis and gain/loss figures are informational estimates based solely on the data you provide. They are not tax advice and may not be defensible without professional review.</li>
  <li><strong>You must consult a qualified professional.</strong> Different transactions can be treated differently (staking, airdrops, bridges, cost-basis method, wash sales). A tax professional may override or recalculate any figure. You are solely responsible for your filings.</li>
  <li><strong>No guarantee of tax treatment.</strong> Even if our figures are correct, a tax authority may dispute your characterization, apply different treatment, or assess penalties. Almstins is not liable for tax outcomes, audits, or penalties.</li>
</ul>

<h2>5. Accounts &amp; Sign-In</h2>
<p>
  You access account features by signing in (for example, with Google or GitHub). You agree to keep your
  sign-in secure, to provide accurate information, and that you are responsible for all activity under your
  account. We collect only the email associated with your sign-in to identify your account — see our
  Privacy Policy for details.
</p>

<h2>6. Subscriptions and Paid Features</h2>
<p>
  Almstins offers optional paid subscription plans. By subscribing you agree to:
</p>
<ul>
  <li>Pay the fees described at the time of purchase</li>
  <li>Allow Stripe (our payment processor) to charge your selected payment method</li>
  <li>The cancellation and refund policies presented at checkout</li>
</ul>
<p>
  Subscriptions are billed through Stripe. We do not store your payment card details.
  Subscriptions may be cancelled at any time from the billing settings in your dashboard.
  We reserve the right to change pricing with reasonable notice to active subscribers.
</p>

<h2>7. No Warranty — "As Is" and "As Available"</h2>
<p>
  The Service is provided <strong>AS IS</strong> and <strong>AS AVAILABLE</strong>, with no
  warranties of any kind — express, implied, or statutory. We specifically disclaim:
</p>
<ul>
  <li>Any warranty of accuracy, completeness, or reliability of data</li>
  <li>Any warranty of fitness for a particular purpose</li>
  <li>Any warranty that the Service will be uninterrupted, error-free, or secure</li>
  <li>Any warranty regarding the accuracy of third-party price feeds, blockchain data, or scam databases</li>
</ul>
<p>You use the Service entirely at your own risk.</p>

<h2>8. Limitation of Liability</h2>
<p>
  To the fullest extent permitted by law, Almstins, its creator (Donnie Starkey / Titanium Hut),
  contributors, and affiliates will <strong>not be liable</strong> for any damages arising from
  your use of or inability to use the Service — including direct, indirect, incidental, special,
  consequential, or punitive damages — even if we have been advised of the possibility of such
  damages.
</p>
<p>This includes, without limitation:</p>
<ul>
  <li>Financial losses or investment decisions made based on Service data</li>
  <li>Tax penalties, audits, or filing errors</li>
  <li>Data loss or inaccurate portfolio calculations</li>
  <li>Losses resulting from reliance on Wallet &amp; Website Checker results</li>
  <li>Service downtime or feature removal during beta</li>
</ul>
<p>
  If any jurisdiction does not allow this limitation, our liability is limited to the maximum
  extent permitted by applicable law.
</p>

<h2>9. Your Responsibilities</h2>
<p>You agree to:</p>
<ul>
  <li>Use the Service only for lawful purposes</li>
  <li>Not attempt to hack, scrape, abuse, or disrupt the hosted Service or its infrastructure, or interfere with other users' data or experience</li>
  <li>Not use the Service to commit fraud, evade taxes, or violate any applicable law</li>
  <li>Keep your login credentials secure — you are responsible for all activity under your account</li>
  <li>Provide accurate information when creating an account or uploading transaction data</li>
</ul>
<p>
  You are solely responsible for any tax reporting, financial decisions, or legal obligations
  related to the wallets, transactions, or data you track using the Service.
</p>

<h2>10. Architectural Privacy Guarantees — What Almstins Will Never Do</h2>
<p>
  Almstins is built on four non-negotiable architectural principles that will never change:
</p>
<ol>
  <li>
    <strong>No Custody.</strong> Almstins never holds, controls, or moves your assets. It never requests
    your private keys, signing permissions, or any wallet connection. A breach of Almstins cannot move a single coin.
  </li>
  <li>
    <strong>No Attribution.</strong> Almstins will <strong>never</strong> link a blockchain address to a person's
    identity. We perform no KYC, identity verification, address clustering, de-anonymization, or attribution of any kind.
    "Who owns this wallet?" is permanently out of scope — this is not a privacy policy choice, it is an architectural guarantee.
  </li>
  <li>
    <strong>Read-Only, Always.</strong> Almstins reads public blockchain data and data you voluntarily provide.
    It makes no changes to the chain, your wallets, or any system beyond our own database.
  </li>
  <li>
    <strong>Absolute Tenant Isolation.</strong> In any multi-tenant or white-label deployment, one tenant
    has no access to another's data — wallets, transactions, records, or identities. This is enforced at the
    data layer, not just in policy.
  </li>
</ol>
<p>
  These guarantees exist because they are the foundation of Almstins' trust model. No government pressure,
  regulatory demand, or business opportunity will cause us to add attribution features, surveillance capabilities,
  or identity-linking functionality. If such features were added, Almstins would become something different entirely.
  We will not do this.
</p>

<h2>11. Third-Party Services</h2>
<p>
  The Service integrates with third-party providers including GitHub and Google (authentication),
  Stripe (payments), Alchemy (blockchain data), CoinGecko and Coinpaprika (price feeds),
  GoPlus and VirusTotal (security data), Chainabuse (scam reporting), Turso (database hosting),
  and Render (hosting). The Wallet &amp; Website Checker additionally surfaces results from public
  reputation sources named in §4a. We are not responsible for the accuracy, availability, or actions
  of these providers.
</p>

<h2>12. Intellectual Property &amp; Open Source</h2>
<p>
  Almstins is open source (MIT License). The source code is available on GitHub. Using the
  hosted Service at almstins.com is subject to these Terms regardless of the open-source nature
  of the underlying code.
</p>
<p>
  While the MIT License does not legally require attribution beyond preserving the copyright
  notice, we kindly ask that anyone building on this codebase acknowledge Almstins and
  Donnie Starkey / Titanium Hut as the original creators. A link back to
  <a href="https://almstins.com">almstins.com</a> or the GitHub repository is always appreciated.
  Open source runs on goodwill — thank you for being part of that.
</p>

<h2>13. Changes to the Service or Terms</h2>
<p>
  We may change, suspend, or discontinue any part of the Service at any time, including during
  the beta period, without prior notice. We may also update these Terms. Continued use of the
  Service after changes are posted constitutes acceptance of the updated Terms.
</p>

<h2>14. Termination</h2>
<p>
  We may suspend or terminate your access at any time for any reason, including violation of
  these Terms. You may delete your account at any time by contacting us.
</p>

<h2>15. Governing Law</h2>
<p>
  These Terms are governed by the laws of the State of Tennessee, United States, without regard
  to conflict of law principles. Any disputes will be resolved in the state or federal courts
  located in Cookeville, Tennessee.
</p>

<h2>16. Contact</h2>
<p>Questions about these Terms? Email: <a href="mailto:donnie@titaniumhut.com">donnie@titaniumhut.com</a></p>
<p>Thank you for using Almstins.</p>
`,
};

export const es: TermsLocale = {
  lang: 'es',
  summaryLabel: 'Términos del Servicio',
  ariaLabel: 'Términos del Servicio',
  body: `
<h1>Términos del Servicio</h1>
<p><strong>Última actualización: 15 de junio de 2026</strong></p>

<p>
  Bienvenido a Almstins («nosotros», «nos», «nuestro»). Estos Términos rigen tu uso de almstins.com y
  todo lo que ofrecemos allí: el <strong>Wallet &amp; Website Checker</strong> gratuito, el
  <strong>rastreador de portafolio y wallets</strong>, las herramientas de <strong>contabilidad,
  desglose de impuestos y resumen anual</strong>, cualquier función del panel y cualquier servicio
  relacionado (en conjunto, el «Servicio»). <strong>Al acceder o usar el Servicio, aceptas estos
  Términos</strong>, tengas o no una cuenta. Si no estás de acuerdo, por favor no uses el Servicio.
</p>

<h2>1. Software en beta — independiente, de solo lectura, verificable</h2>
<p>
  Almstins está en <strong>beta</strong>. Eso significa que seguimos aprendiendo qué necesitan los
  usuarios, qué necesitan las personas en mercados emergentes y cómo es la próxima capa de seguridad.
  Lo estamos construyendo de forma abierta e iterando según el feedback real.
</p>
<p>
  Estar en beta no significa que el código sea inestable ni que tus datos estén en riesgo. Significa que
  las funciones pueden evolucionar y que podemos introducir nuevas según el feedback de los usuarios. La
  promesa central —acceso de solo lectura, sin conexión de wallet, verificable contra la cadena— es
  arquitectónica, no provisional.
</p>
<p>
  <strong>Verifica todo contra la cadena.</strong> Como Almstins lee datos públicos de la blockchain,
  puedes comprobar por ti mismo cada saldo, cada transacción y cada cálculo. Ese es el objetivo.
</p>

<h2>2. Elegibilidad, sanciones y restricciones geográficas</h2>
<p><strong>No</strong> puedes usar Almstins si eres:</p>
<ul>
  <li>Una persona, entidad u organización incluida en alguna lista de sanciones de la OFAC (Office of Foreign Assets Control) o sujeta de otro modo a sanciones económicas de EE. UU. o internacionales</li>
  <li>Alguien que opera bajo jurisdicciones que prohíben o restringen el uso de criptomonedas, donde usar Almstins infringiría la ley local</li>
  <li>Alguien que usa el Servicio para eludir controles de capital, restricciones cambiarias o para evitar requisitos legales de información financiera de tu jurisdicción</li>
  <li>Alguien que usa el Servicio para facilitar el blanqueo de capitales, la financiación del terrorismo, el fraude u otros delitos financieros</li>
</ul>
<p>
  <strong>Restricciones geográficas y tu declaración.</strong> Almstins y sus afiliadas no ofrecen el
  Servicio a, ni hacen negocios con, ninguna persona, entidad o jurisdicción restringida conforme a las
  leyes de sanciones económicas aplicables o prohibida por nuestros proveedores de pago y cumplimiento.
  <strong>Al acceder o usar el Servicio, declaras y garantizas que no te encuentras, no resides
  habitualmente, ni accedes al Servicio desde ninguna jurisdicción sancionada de forma integral —
  incluidas Cuba, Irán, Corea del Norte, Siria, o las regiones de Crimea, Donetsk o Lugansk de
  Ucrania.</strong> Podemos usar geolocalización para restringir el acceso desde estos lugares; esta
  declaración se aplica además de, y con independencia de, cualquier control técnico.
</p>
<p>
  Si estás sujeto a alguna de estas restricciones, no puedes crear una cuenta ni acceder al Servicio.
  El uso continuado en violación de esta sección puede dar lugar a la terminación inmediata de tu cuenta
  y a la notificación a las autoridades correspondientes según lo exija la ley.
</p>

<h2>3. Qué es Almstins — y qué no es</h2>
<p>
  Almstins es una <strong>herramienta de seguimiento de inversiones, contabilidad y seguridad</strong>.
  Te ayuda a ver dónde están tus tenencias de cripto y cómo se han movido, a organizar tus transacciones
  y tu base de coste, y a verificar direcciones de wallet y sitios web antes de enviar fondos.
</p>
<p>Almstins <strong>no</strong> es:</p>
<ul>
  <li>Un servicio de preparación de impuestos</li>
  <li>Un asesor fiscal ni un contador</li>
  <li>Un asesor financiero ni un asesor de inversiones</li>
  <li>Un servicio jurídico</li>
  <li>Un producto financiero certificado o regulado</li>
  <li>Un custodio, wallet o exchange: nunca retiene, mueve ni tiene acceso a tus fondos</li>
</ul>
<p>
  Cualquier resumen relacionado con impuestos, estimación de base de coste, cifra de ganancias/pérdidas,
  vista de contabilidad o resultado de seguridad se proporciona <strong>solo con fines informativos y de
  organización</strong>. No constituyen asesoramiento de ningún tipo y no sustituyen a un profesional
  cualificado. Eres el único responsable de tus propias decisiones, declaraciones de impuestos, reportes
  y cumplimiento.
</p>

<h2>4. El Servicio — funciones específicas</h2>

<h3>4a. Wallet &amp; Website Scam Checker</h3>
<p>
  El Checker es una herramienta <strong>gratuita e informativa</strong>. Consulta bases de datos públicas
  de reputación de terceros (como GoPlus, datos de sanciones de la OFAC, honeypot.is, Chainabuse, la lista
  de phishing de MetaMask, ScamSniffer, URLScan y OpenPhish) y reporta lo que estas indican.
</p>
<ul>
  <li><strong>Atribución, no veredicto.</strong> Reportamos lo que reportan las bases de datos de terceros. No investigamos, verificamos ni declaramos de forma independiente que una dirección o un sitio web sea una estafa — ni que sea seguro.</li>
  <li><strong>Sin garantía, en ningún sentido.</strong> Un resultado «limpio» o «parece seguro» significa únicamente que ninguna fuente que consultamos lo ha marcado — no que sea seguro. Un resultado marcado refleja un reporte de terceros, no una determinación nuestra. Las nuevas estafas aparecen más rápido de lo que se actualizan las bases de datos.</li>
  <li><strong>Sin dependencia.</strong> El Checker es una señal entre muchas. <strong>Debes verificar de forma independiente cualquier dirección o sitio web antes de enviar fondos o conectar una wallet.</strong> No somos responsables de ninguna pérdida derivada de la confianza en los resultados del Checker.</li>
  <li>Cualquier señal de la comunidad (reportes, insignias de confianza, reseñas), donde y si se ofrece, es solo informativa y <strong>no</strong> constituye una garantía de seguridad, legitimidad o calidad.</li>
</ul>

<h3>4b. Rastreador de portafolio y wallets</h3>
<p>
  El rastreador lee datos <strong>públicos</strong> de la blockchain para las direcciones de wallet que
  proporcionas voluntariamente, junto con los datos que importas (como CSV de exchanges y entradas
  manuales), para mostrar saldos, tenencias y rendimiento a lo largo del tiempo.
</p>
<ul>
  <li><strong>Solo lectura, sin custodia, sin conexión.</strong> Almstins nunca solicita tus private keys, tu seed phrase ni ninguna conexión de wallet, y nunca retiene ni mueve fondos. Una brecha en Almstins no puede mover ni una sola moneda.</li>
  <li><strong>Tú aportas las direcciones.</strong> Eres responsable de las direcciones de wallet y los registros que decides rastrear. Almstins no vincula ninguna dirección con tu identidad (ver §10).</li>
  <li><strong>La exactitud depende de tus datos y de datos de terceros.</strong> Los saldos, precios e historial provienen de fuentes públicas y de tus importaciones, y pueden estar retrasados, incompletos o ser erróneos. «Si entra basura, sale basura»: datos incompletos o inexactos producen cifras poco fiables.</li>
</ul>

<h3>4c. Contabilidad, desglose de impuestos y resumen anual</h3>
<p>
  Las herramientas de contabilidad organizan tus transacciones y calculan cifras informativas: base de
  coste, ganancias/pérdidas realizadas y no realizadas, conciliación y un resumen de fin de año que puedes
  entregar a un profesional.
</p>
<ul>
  <li><strong>No es asesoramiento fiscal.</strong> Las cifras de base de coste y de ganancias/pérdidas son estimaciones informativas basadas únicamente en los datos que proporcionas. No constituyen asesoramiento fiscal y pueden no ser defendibles sin una revisión profesional.</li>
  <li><strong>Debes consultar a un profesional cualificado.</strong> Distintas transacciones pueden tratarse de forma diferente (staking, airdrops, bridges, método de base de coste, wash sales). Un profesional fiscal puede anular o recalcular cualquier cifra. Eres el único responsable de tus declaraciones.</li>
  <li><strong>Sin garantía de tratamiento fiscal.</strong> Aunque nuestras cifras sean correctas, una autoridad fiscal puede cuestionar tu caracterización, aplicar un tratamiento diferente o imponer sanciones. Almstins no es responsable de los resultados fiscales, auditorías ni sanciones.</li>
</ul>

<h2>5. Cuentas e inicio de sesión</h2>
<p>
  Accedes a las funciones de cuenta iniciando sesión (por ejemplo, con Google o GitHub). Aceptas mantener
  seguro tu inicio de sesión, proporcionar información veraz y ser responsable de toda la actividad bajo tu
  cuenta. Solo recopilamos el correo electrónico asociado a tu inicio de sesión para identificar tu cuenta —
  consulta nuestra Política de Privacidad para más detalles.
</p>

<h2>6. Suscripciones y funciones de pago</h2>
<p>
  Almstins ofrece planes de suscripción de pago opcionales. Al suscribirte aceptas:
</p>
<ul>
  <li>Pagar las tarifas descritas en el momento de la compra</li>
  <li>Permitir que Stripe (nuestro procesador de pagos) cargue el método de pago que selecciones</li>
  <li>Las políticas de cancelación y reembolso presentadas en el momento del pago</li>
</ul>
<p>
  Las suscripciones se facturan a través de Stripe. No almacenamos los datos de tu tarjeta de pago.
  Las suscripciones pueden cancelarse en cualquier momento desde la configuración de facturación de tu panel.
  Nos reservamos el derecho de cambiar los precios con un aviso razonable a los suscriptores activos.
</p>

<h2>7. Sin garantía — «tal cual» y «según disponibilidad»</h2>
<p>
  El Servicio se proporciona <strong>TAL CUAL</strong> y <strong>SEGÚN DISPONIBILIDAD</strong>, sin
  garantías de ningún tipo — expresas, implícitas o legales. En particular, renunciamos a:
</p>
<ul>
  <li>Cualquier garantía de exactitud, integridad o fiabilidad de los datos</li>
  <li>Cualquier garantía de idoneidad para un propósito particular</li>
  <li>Cualquier garantía de que el Servicio sea ininterrumpido, libre de errores o seguro</li>
  <li>Cualquier garantía sobre la exactitud de los feeds de precios de terceros, los datos de la blockchain o las bases de datos de estafas</li>
</ul>
<p>Usas el Servicio enteramente bajo tu propio riesgo.</p>

<h2>8. Limitación de responsabilidad</h2>
<p>
  En la máxima medida permitida por la ley, Almstins, su creador (Donnie Starkey / Titanium Hut),
  los colaboradores y las afiliadas <strong>no serán responsables</strong> de ningún daño derivado de tu
  uso o de la imposibilidad de usar el Servicio — incluidos daños directos, indirectos, incidentales,
  especiales, consecuentes o punitivos — incluso si se nos ha advertido de la posibilidad de tales daños.
</p>
<p>Esto incluye, sin limitación:</p>
<ul>
  <li>Pérdidas financieras o decisiones de inversión tomadas con base en datos del Servicio</li>
  <li>Sanciones fiscales, auditorías o errores en las declaraciones</li>
  <li>Pérdida de datos o cálculos de portafolio inexactos</li>
  <li>Pérdidas derivadas de la confianza en los resultados del Wallet &amp; Website Checker</li>
  <li>Caídas del Servicio o eliminación de funciones durante la beta</li>
</ul>
<p>
  Si alguna jurisdicción no permite esta limitación, nuestra responsabilidad se limita al máximo grado
  permitido por la ley aplicable.
</p>

<h2>9. Tus responsabilidades</h2>
<p>Aceptas:</p>
<ul>
  <li>Usar el Servicio únicamente para fines lícitos</li>
  <li>No intentar hackear, hacer scraping, abusar de o interrumpir el Servicio alojado o su infraestructura, ni interferir con los datos o la experiencia de otros usuarios</li>
  <li>No usar el Servicio para cometer fraude, evadir impuestos ni violar ninguna ley aplicable</li>
  <li>Mantener seguras tus credenciales de acceso — eres responsable de toda la actividad bajo tu cuenta</li>
  <li>Proporcionar información veraz al crear una cuenta o subir datos de transacciones</li>
</ul>
<p>
  Eres el único responsable de cualquier reporte fiscal, decisión financiera u obligación legal relacionada
  con las wallets, transacciones o datos que rastreas usando el Servicio.
</p>

<h2>10. Garantías arquitectónicas de privacidad — lo que Almstins nunca hará</h2>
<p>
  Almstins se construye sobre cuatro principios arquitectónicos innegociables que nunca cambiarán:
</p>
<ol>
  <li>
    <strong>Sin custodia.</strong> Almstins nunca retiene, controla ni mueve tus activos. Nunca solicita
    tus private keys, permisos de firma ni ninguna conexión de wallet. Una brecha en Almstins no puede mover ni una sola moneda.
  </li>
  <li>
    <strong>Sin atribución.</strong> Almstins <strong>nunca</strong> vinculará una dirección de la blockchain con la
    identidad de una persona. No realizamos KYC, verificación de identidad, clustering de direcciones, desanonimización ni atribución de ningún tipo.
    «¿Quién es el dueño de esta wallet?» queda permanentemente fuera de alcance — esto no es una decisión de política de privacidad, es una garantía arquitectónica.
  </li>
  <li>
    <strong>Solo lectura, siempre.</strong> Almstins lee datos públicos de la blockchain y datos que proporcionas voluntariamente.
    No realiza cambios en la cadena, en tus wallets ni en ningún sistema más allá de nuestra propia base de datos.
  </li>
  <li>
    <strong>Aislamiento absoluto entre inquilinos.</strong> En cualquier despliegue multi-inquilino o de marca blanca, un inquilino
    no tiene acceso a los datos de otro — wallets, transacciones, registros o identidades. Esto se aplica en la
    capa de datos, no solo en la política.
  </li>
</ol>
<p>
  Estas garantías existen porque son la base del modelo de confianza de Almstins. Ninguna presión gubernamental,
  exigencia regulatoria ni oportunidad de negocio nos hará añadir funciones de atribución, capacidades de vigilancia
  ni funcionalidad de vinculación de identidad. Si se añadieran tales funciones, Almstins se convertiría en algo completamente distinto.
  No lo haremos.
</p>

<h2>11. Servicios de terceros</h2>
<p>
  El Servicio se integra con proveedores externos, incluidos GitHub y Google (autenticación),
  Stripe (pagos), Alchemy (datos de blockchain), CoinGecko y Coinpaprika (feeds de precios),
  GoPlus y VirusTotal (datos de seguridad), Chainabuse (reportes de estafas), Turso (alojamiento de base de datos)
  y Render (alojamiento). El Wallet &amp; Website Checker también muestra resultados de fuentes públicas
  de reputación nombradas en §4a. No somos responsables de la exactitud, disponibilidad ni acciones
  de estos proveedores.
</p>

<h2>12. Propiedad intelectual y código abierto</h2>
<p>
  Almstins es de código abierto (MIT License). El código fuente está disponible en GitHub. El uso del
  Servicio alojado en almstins.com está sujeto a estos Términos con independencia de la naturaleza de
  código abierto del código subyacente.
</p>
<p>
  Aunque la MIT License no exige legalmente atribución más allá de conservar el aviso de copyright,
  pedimos amablemente que quien construya sobre este código reconozca a Almstins y a
  Donnie Starkey / Titanium Hut como los creadores originales. Un enlace de vuelta a
  <a href="https://almstins.com">almstins.com</a> o al repositorio de GitHub siempre se agradece.
  El código abierto funciona con buena voluntad — gracias por ser parte de eso.
</p>

<h2>13. Cambios en el Servicio o en los Términos</h2>
<p>
  Podemos cambiar, suspender o discontinuar cualquier parte del Servicio en cualquier momento, incluso durante
  el periodo de beta, sin previo aviso. También podemos actualizar estos Términos. El uso continuado del
  Servicio después de que se publiquen los cambios constituye la aceptación de los Términos actualizados.
</p>

<h2>14. Terminación</h2>
<p>
  Podemos suspender o terminar tu acceso en cualquier momento por cualquier motivo, incluida la violación de
  estos Términos. Puedes eliminar tu cuenta en cualquier momento contactándonos.
</p>

<h2>15. Ley aplicable</h2>
<p>
  Estos Términos se rigen por las leyes del Estado de Tennessee, Estados Unidos, sin tener en cuenta
  los principios de conflicto de leyes. Cualquier disputa se resolverá en los tribunales estatales o federales
  ubicados en Cookeville, Tennessee.
</p>

<h2>16. Contacto</h2>
<p>¿Preguntas sobre estos Términos? Correo: <a href="mailto:donnie@titaniumhut.com">donnie@titaniumhut.com</a></p>
<p>Gracias por usar Almstins.</p>
`,
};

export const fr: TermsLocale = {
  lang: 'fr',
  summaryLabel: 'Conditions d’Utilisation',
  ariaLabel: 'Conditions d’Utilisation',
  body: `
<h1>Conditions d’Utilisation</h1>
<p><strong>Dernière mise à jour : 15 juin 2026</strong></p>

<p>
  Bienvenue sur Almstins (« nous », « notre »). Les présentes Conditions régissent votre utilisation de
  almstins.com et de tout ce que nous y proposons — le <strong>Wallet &amp; Website Checker</strong> gratuit,
  le <strong>suivi de portefeuille et de wallets</strong>, les outils de <strong>comptabilité, de ventilation
  fiscale et de récapitulatif annuel</strong>, toute fonctionnalité du tableau de bord et tout service
  connexe (collectivement, le « Service »). <strong>En accédant au Service ou en l’utilisant, vous acceptez
  ces Conditions</strong> — que vous créiez un compte ou non. Si vous n’êtes pas d’accord, veuillez ne pas
  utiliser le Service.
</p>

<h2>1. Logiciel en bêta — indépendant, en lecture seule, vérifiable</h2>
<p>
  Almstins est en <strong>bêta</strong>. Cela signifie que nous apprenons encore ce dont les utilisateurs ont
  besoin, ce dont les utilisateurs des marchés émergents ont besoin, et à quoi ressemble la prochaine couche de
  sécurité. Nous le construisons ouvertement et itérons en fonction des retours réels.
</p>
<p>
  Être en bêta ne signifie pas que le code est instable ou que vos données sont en danger. Cela signifie que les
  fonctionnalités peuvent évoluer et que nous pouvons en introduire de nouvelles selon les retours des
  utilisateurs. La promesse centrale — accès en lecture seule, aucune connexion de wallet, vérifiable contre la
  chaîne — est architecturale, et non provisoire.
</p>
<p>
  <strong>Vérifiez tout contre la chaîne.</strong> Parce qu’Almstins lit des données publiques de la blockchain,
  vous pouvez recouper vous-même chaque solde, chaque transaction, chaque calcul. C’est tout l’intérêt.
</p>

<h2>2. Éligibilité, sanctions et restrictions géographiques</h2>
<p>Vous <strong>ne pouvez pas</strong> utiliser Almstins si vous êtes :</p>
<ul>
  <li>Une personne, entité ou organisation figurant sur une liste de sanctions de l’OFAC (Office of Foreign Assets Control) ou autrement soumise à des sanctions économiques américaines ou internationales</li>
  <li>Une personne opérant sous des juridictions qui interdisent ou restreignent l’usage des cryptomonnaies, où l’utilisation d’Almstins enfreindrait la loi locale</li>
  <li>Une personne utilisant le Service pour contourner des contrôles de capitaux, des restrictions de change, ou pour échapper aux obligations légales de déclaration financière de votre juridiction</li>
  <li>Une personne utilisant le Service pour faciliter le blanchiment d’argent, le financement du terrorisme, la fraude ou d’autres délits financiers</li>
</ul>
<p>
  <strong>Restrictions géographiques et votre déclaration.</strong> Almstins et ses affiliés n’offrent pas le
  Service à, et ne font pas affaire avec, aucune personne, entité ou juridiction restreinte en vertu des lois de
  sanctions économiques applicables ou interdite par nos prestataires de paiement et de conformité.
  <strong>En accédant au Service ou en l’utilisant, vous déclarez et garantissez que vous n’êtes pas situé,
  ne résidez pas habituellement, et n’accédez pas au Service depuis une juridiction faisant l’objet de
  sanctions globales — y compris Cuba, l’Iran, la Corée du Nord, la Syrie, ou les régions de Crimée, de
  Donetsk ou de Louhansk en Ukraine.</strong> Nous pouvons recourir à la géolocalisation pour restreindre
  l’accès depuis ces lieux ; cette déclaration s’applique en plus de, et indépendamment de, tout contrôle technique.
</p>
<p>
  Si vous êtes soumis à l’une de ces restrictions, vous ne pouvez pas créer de compte ni accéder au Service.
  Toute utilisation continue en violation de la présente section peut entraîner la résiliation immédiate de votre
  compte et le signalement aux autorités compétentes, comme l’exige la loi.
</p>

<h2>3. Ce qu’Almstins est — et n’est pas</h2>
<p>
  Almstins est un <strong>outil de suivi d’investissements, de comptabilité et de sécurité</strong>. Il vous aide
  à voir où se trouvent vos avoirs en crypto et comment ils ont évolué, à organiser vos transactions et votre coût
  de base, et à vérifier des adresses de wallet et des sites web avant d’envoyer des fonds.
</p>
<p>Almstins <strong>n’est pas</strong> :</p>
<ul>
  <li>Un service de préparation des déclarations fiscales</li>
  <li>Un conseiller fiscal ni un comptable</li>
  <li>Un conseiller financier ni un conseiller en investissement</li>
  <li>Un service juridique</li>
  <li>Un produit financier certifié ou réglementé</li>
  <li>Un dépositaire, un wallet ou un exchange — il ne détient, ne déplace ni n’accède jamais à vos fonds</li>
</ul>
<p>
  Tout récapitulatif lié aux impôts, estimation de coût de base, chiffre de gains/pertes, vue comptable ou
  résultat de sécurité est fourni <strong>à des fins d’information et d’organisation uniquement</strong>. Il ne
  constitue en aucun cas un conseil et ne remplace pas un professionnel qualifié. Vous êtes seul responsable de vos
  propres décisions, déclarations fiscales, déclarations et conformité.
</p>

<h2>4. Le Service — fonctionnalités spécifiques</h2>

<h3>4a. Wallet &amp; Website Scam Checker</h3>
<p>
  Le Checker est un outil <strong>gratuit et informatif</strong>. Il interroge des bases de données publiques de
  réputation de tiers (telles que GoPlus, les données de sanctions de l’OFAC, honeypot.is, Chainabuse, la liste de
  phishing de MetaMask, ScamSniffer, URLScan et OpenPhish) et rapporte ce qu’elles indiquent.
</p>
<ul>
  <li><strong>Attribution, pas verdict.</strong> Nous rapportons ce que rapportent les bases de données tierces. Nous n’enquêtons pas, ne vérifions pas et ne déclarons pas de façon indépendante qu’une adresse ou un site web est une arnaque — ni qu’il est sûr.</li>
  <li><strong>Aucune garantie, dans un sens comme dans l’autre.</strong> Un résultat « propre » ou « semble sûr » signifie seulement qu’aucune source que nous avons consultée ne l’a signalé — non qu’il est sûr. Un résultat signalé reflète un rapport de tiers, et non notre propre détermination. De nouvelles arnaques apparaissent plus vite que les bases de données ne se mettent à jour.</li>
  <li><strong>Aucune dépendance.</strong> Le Checker est un signal parmi d’autres. <strong>Vous devez vérifier de façon indépendante toute adresse ou tout site web avant d’envoyer des fonds ou de connecter un wallet.</strong> Nous ne sommes pas responsables des pertes résultant de la confiance accordée aux résultats du Checker.</li>
  <li>Tout signal communautaire (signalements, badges de confiance, avis), lorsqu’il est proposé, est purement informatif et ne constitue <strong>pas</strong> une garantie de sécurité, de légitimité ou de qualité.</li>
</ul>

<h3>4b. Suivi de portefeuille et de wallets</h3>
<p>
  Le suivi lit des données <strong>publiques</strong> de la blockchain pour les adresses de wallet que vous
  fournissez volontairement, ainsi que les données que vous importez (telles que des CSV d’exchanges et des saisies
  manuelles), afin d’afficher les soldes, les avoirs et la performance dans le temps.
</p>
<ul>
  <li><strong>Lecture seule, aucune garde, aucune connexion.</strong> Almstins ne demande jamais vos private keys, votre seed phrase ni aucune connexion de wallet, et ne détient ni ne déplace jamais de fonds. Une faille d’Almstins ne peut déplacer la moindre pièce.</li>
  <li><strong>Vous fournissez les adresses.</strong> Vous êtes responsable des adresses de wallet et des enregistrements que vous choisissez de suivre. Almstins ne relie aucune adresse à votre identité (voir §10).</li>
  <li><strong>L’exactitude dépend de vos saisies et des données de tiers.</strong> Les soldes, prix et historiques proviennent de sources publiques et de vos imports, et peuvent être retardés, incomplets ou erronés. « Garbage in, garbage out » : des saisies incomplètes ou inexactes produisent des chiffres peu fiables.</li>
</ul>

<h3>4c. Comptabilité, ventilation fiscale et récapitulatif annuel</h3>
<p>
  Les outils de comptabilité organisent vos transactions et calculent des chiffres informatifs — coût de base,
  gains/pertes réalisés et latents, rapprochement, et un récapitulatif de fin d’année que vous pouvez remettre à un
  professionnel.
</p>
<ul>
  <li><strong>Pas un conseil fiscal.</strong> Les chiffres de coût de base et de gains/pertes sont des estimations informatives fondées uniquement sur les données que vous fournissez. Ils ne constituent pas un conseil fiscal et peuvent ne pas être défendables sans examen professionnel.</li>
  <li><strong>Vous devez consulter un professionnel qualifié.</strong> Différentes transactions peuvent être traitées différemment (staking, airdrops, bridges, méthode de coût de base, wash sales). Un professionnel fiscal peut annuler ou recalculer n’importe quel chiffre. Vous êtes seul responsable de vos déclarations.</li>
  <li><strong>Aucune garantie de traitement fiscal.</strong> Même si nos chiffres sont corrects, une administration fiscale peut contester votre qualification, appliquer un traitement différent ou imposer des pénalités. Almstins n’est pas responsable des résultats fiscaux, des contrôles ni des pénalités.</li>
</ul>

<h2>5. Comptes et connexion</h2>
<p>
  Vous accédez aux fonctionnalités de compte en vous connectant (par exemple, avec Google ou GitHub). Vous acceptez
  de garder votre connexion sécurisée, de fournir des informations exactes, et d’être responsable de toute activité
  sous votre compte. Nous ne collectons que l’adresse e-mail associée à votre connexion pour identifier votre compte —
  voir notre Politique de Confidentialité pour plus de détails.
</p>

<h2>6. Abonnements et fonctionnalités payantes</h2>
<p>
  Almstins propose des formules d’abonnement payantes optionnelles. En vous abonnant, vous acceptez de :
</p>
<ul>
  <li>Payer les frais décrits au moment de l’achat</li>
  <li>Autoriser Stripe (notre processeur de paiement) à débiter le moyen de paiement que vous avez sélectionné</li>
  <li>Les politiques d’annulation et de remboursement présentées au moment du paiement</li>
</ul>
<p>
  Les abonnements sont facturés via Stripe. Nous ne stockons pas les détails de votre carte de paiement.
  Les abonnements peuvent être annulés à tout moment depuis les paramètres de facturation de votre tableau de bord.
  Nous nous réservons le droit de modifier les tarifs moyennant un préavis raisonnable aux abonnés actifs.
</p>

<h2>7. Aucune garantie — « en l’état » et « selon disponibilité »</h2>
<p>
  Le Service est fourni <strong>EN L’ÉTAT</strong> et <strong>SELON DISPONIBILITÉ</strong>, sans
  garantie d’aucune sorte — expresse, implicite ou légale. Nous déclinons en particulier :
</p>
<ul>
  <li>Toute garantie d’exactitude, d’exhaustivité ou de fiabilité des données</li>
  <li>Toute garantie d’adéquation à un usage particulier</li>
  <li>Toute garantie que le Service sera ininterrompu, exempt d’erreurs ou sécurisé</li>
  <li>Toute garantie concernant l’exactitude des flux de prix tiers, des données de la blockchain ou des bases de données d’arnaques</li>
</ul>
<p>Vous utilisez le Service entièrement à vos propres risques.</p>

<h2>8. Limitation de responsabilité</h2>
<p>
  Dans toute la mesure permise par la loi, Almstins, son créateur (Donnie Starkey / Titanium Hut),
  les contributeurs et les affiliés <strong>ne seront pas responsables</strong> des dommages découlant de
  votre utilisation ou de votre incapacité à utiliser le Service — y compris les dommages directs, indirects,
  accessoires, spéciaux, consécutifs ou punitifs — même si nous avons été informés de la possibilité de tels dommages.
</p>
<p>Cela inclut, sans limitation :</p>
<ul>
  <li>Les pertes financières ou les décisions d’investissement prises sur la base des données du Service</li>
  <li>Les pénalités fiscales, contrôles ou erreurs de déclaration</li>
  <li>La perte de données ou des calculs de portefeuille inexacts</li>
  <li>Les pertes résultant de la confiance accordée aux résultats du Wallet &amp; Website Checker</li>
  <li>Les interruptions du Service ou la suppression de fonctionnalités pendant la bêta</li>
</ul>
<p>
  Si une juridiction n’autorise pas cette limitation, notre responsabilité est limitée dans toute la mesure
  permise par la loi applicable.
</p>

<h2>9. Vos responsabilités</h2>
<p>Vous acceptez de :</p>
<ul>
  <li>N’utiliser le Service qu’à des fins licites</li>
  <li>Ne pas tenter de pirater, scraper, abuser ou perturber le Service hébergé ou son infrastructure, ni d’interférer avec les données ou l’expérience d’autres utilisateurs</li>
  <li>Ne pas utiliser le Service pour commettre une fraude, échapper à l’impôt ou enfreindre une loi applicable</li>
  <li>Garder vos identifiants de connexion sécurisés — vous êtes responsable de toute activité sous votre compte</li>
  <li>Fournir des informations exactes lors de la création d’un compte ou du téléversement de données de transactions</li>
</ul>
<p>
  Vous êtes seul responsable de toute déclaration fiscale, décision financière ou obligation légale liée aux
  wallets, transactions ou données que vous suivez à l’aide du Service.
</p>

<h2>10. Garanties architecturales de confidentialité — ce qu’Almstins ne fera jamais</h2>
<p>
  Almstins repose sur quatre principes architecturaux non négociables qui ne changeront jamais :
</p>
<ol>
  <li>
    <strong>Aucune garde.</strong> Almstins ne détient, ne contrôle ni ne déplace jamais vos actifs. Il ne demande jamais
    vos private keys, des autorisations de signature ni aucune connexion de wallet. Une faille d’Almstins ne peut déplacer la moindre pièce.
  </li>
  <li>
    <strong>Aucune attribution.</strong> Almstins ne reliera <strong>jamais</strong> une adresse de la blockchain à
    l’identité d’une personne. Nous n’effectuons aucun KYC, aucune vérification d’identité, aucun clustering d’adresses, aucune désanonymisation ni aucune attribution d’aucune sorte.
    « À qui appartient ce wallet ? » est définitivement hors de portée — ce n’est pas un choix de politique de confidentialité, c’est une garantie architecturale.
  </li>
  <li>
    <strong>Lecture seule, toujours.</strong> Almstins lit des données publiques de la blockchain et des données que vous fournissez volontairement.
    Il n’apporte aucune modification à la chaîne, à vos wallets ni à aucun système au-delà de notre propre base de données.
  </li>
  <li>
    <strong>Isolation absolue des locataires.</strong> Dans tout déploiement multi-locataire ou en marque blanche, un locataire
    n’a aucun accès aux données d’un autre — wallets, transactions, enregistrements ou identités. Cela est appliqué au niveau de la
    couche de données, et pas seulement dans la politique.
  </li>
</ol>
<p>
  Ces garanties existent parce qu’elles sont le fondement du modèle de confiance d’Almstins. Aucune pression gouvernementale,
  exigence réglementaire ni opportunité commerciale ne nous fera ajouter des fonctions d’attribution, des capacités de surveillance
  ni une fonctionnalité de liaison d’identité. Si de telles fonctions étaient ajoutées, Almstins deviendrait quelque chose de totalement différent.
  Nous ne le ferons pas.
</p>

<h2>11. Services tiers</h2>
<p>
  Le Service s’intègre à des prestataires tiers, notamment GitHub et Google (authentification),
  Stripe (paiements), Alchemy (données de blockchain), CoinGecko et Coinpaprika (flux de prix),
  GoPlus et VirusTotal (données de sécurité), Chainabuse (signalement d’arnaques), Turso (hébergement de base de données)
  et Render (hébergement). Le Wallet &amp; Website Checker fait également remonter des résultats de sources publiques
  de réputation nommées au §4a. Nous ne sommes pas responsables de l’exactitude, de la disponibilité ni des actions
  de ces prestataires.
</p>

<h2>12. Propriété intellectuelle et open source</h2>
<p>
  Almstins est open source (MIT License). Le code source est disponible sur GitHub. L’utilisation du
  Service hébergé sur almstins.com est soumise aux présentes Conditions, indépendamment de la nature
  open source du code sous-jacent.
</p>
<p>
  Bien que la MIT License n’exige pas légalement d’attribution au-delà de la conservation de l’avis de copyright,
  nous demandons aimablement que quiconque s’appuie sur ce code reconnaisse Almstins et
  Donnie Starkey / Titanium Hut comme les créateurs d’origine. Un lien de retour vers
  <a href="https://almstins.com">almstins.com</a> ou vers le dépôt GitHub est toujours apprécié.
  L’open source fonctionne grâce à la bonne volonté — merci d’en faire partie.
</p>

<h2>13. Modifications du Service ou des Conditions</h2>
<p>
  Nous pouvons modifier, suspendre ou interrompre toute partie du Service à tout moment, y compris pendant
  la période de bêta, sans préavis. Nous pouvons également mettre à jour ces Conditions. L’utilisation continue du
  Service après la publication des modifications vaut acceptation des Conditions mises à jour.
</p>

<h2>14. Résiliation</h2>
<p>
  Nous pouvons suspendre ou résilier votre accès à tout moment et pour quelque raison que ce soit, y compris en cas de violation
  des présentes Conditions. Vous pouvez supprimer votre compte à tout moment en nous contactant.
</p>

<h2>15. Droit applicable</h2>
<p>
  Les présentes Conditions sont régies par les lois de l’État du Tennessee, États-Unis, sans égard
  aux principes de conflit de lois. Tout litige sera résolu devant les tribunaux étatiques ou fédéraux
  situés à Cookeville, Tennessee.
</p>

<h2>16. Contact</h2>
<p>Des questions sur ces Conditions ? E-mail : <a href="mailto:donnie@titaniumhut.com">donnie@titaniumhut.com</a></p>
<p>Merci d’utiliser Almstins.</p>
`,
};

const MAP: Record<Lang, TermsLocale> = { en, es, fr };

/** Select the Terms locale for a language, falling back to English. */
export function getTerms(lang: Lang): TermsLocale {
  return MAP[lang] ?? en;
}
