// Privacy Policy — footer-modal content, all user-visible copy (EN · ES · FR).
//
// Rendered by src/components/privacy-policy.astro (inline <details> on some pages,
// and as the footer "privacy-policy" modal via Footer.astro). The component takes a
// `lang` prop and selects the locale with getPrivacy(lang); the modal inherits the
// page's language from the Footer, so there are no per-locale routes for this surface.
//
// `body` is developer-controlled HTML rendered with set:html. Proper nouns (GitHub,
// Stripe, Alchemy, Turso…) and crypto jargon stay in English per design.claude.md.
// ES/FR are first-pass legal copy — gate behind counsel + a fluent reviewer before
// treating as authoritative. (Note: the EN source still mentions name/profile-picture
// collection; reconcile with the email-only sign-up + ToS §5 during legal review.)

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
<h1>Privacy Policy</h1>
<p><strong>Last updated: March 31, 2026</strong></p>

<p>
  Almstins ("we", "us", "our") operates almstins.com and related services (the "Service").
  This policy explains what data we collect, why, how we use it, and what we do
  <strong>not</strong> do with it.
</p>
<p>
  This policy applies to all visitors and users — whether or not you have an account.
</p>

<h2>1. Information We Collect</h2>

<h3>If You Only Visit (No Account)</h3>
<ul>
  <li>IP address (used for approximate location and abuse prevention only)</li>
  <li>Browser type, device type, operating system, language preference</li>
  <li>Pages visited, time spent, and basic interaction events</li>
  <li>Referral source (where you came from)</li>
</ul>

<h3>If You Create an Account</h3>
<ul>
  <li>Email address (if provided via GitHub or directly)</li>
  <li>Name and profile picture (if provided by GitHub OAuth)</li>
  <li>Internal user ID and session tokens</li>
  <li>Account creation date and last login</li>
</ul>

<h3>If You Add Wallets or Upload Transaction Data</h3>
<ul>
  <li>Public wallet addresses you choose to add</li>
  <li>On-chain transaction history fetched for those addresses</li>
  <li>Transaction CSV data you upload from exchanges (e.g. Crypto.com, Coinbase, Exodus)</li>
  <li>Exchange account labels and nicknames you assign</li>
</ul>

<h3>If You Subscribe (Paid Plan)</h3>
<ul>
  <li>Stripe customer ID and subscription status (we do not store card details)</li>
  <li>Billing email and name (as provided to Stripe)</li>
</ul>

<p>We do <strong>not</strong> collect:</p>
<ul>
  <li>Private keys, seed phrases, or wallet passwords — ever</li>
  <li>Precise GPS location</li>
  <li>Browsing history outside almstins.com</li>
  <li>Payment card numbers (handled entirely by Stripe)</li>
</ul>

<h2>2. How We Use Your Data</h2>
<ul>
  <li>To operate, display, and improve your dashboard and portfolio tracking</li>
  <li>To authenticate your account and keep your session secure</li>
  <li>To process subscription payments via Stripe</li>
  <li>To detect and prevent abuse, fraud, or malicious activity</li>
  <li>To understand how the Service is used (aggregate, anonymized analytics)</li>
  <li>To contact you about security issues or major Service changes (no marketing without consent)</li>
</ul>

<p>We do <strong>not</strong>:</p>
<ul>
  <li>Sell your data or wallet addresses to anyone</li>
  <li>Share identifiable data with advertisers</li>
  <li>Use your financial data to make investment decisions or recommendations</li>
  <li>Send marketing emails without your explicit opt-in</li>
</ul>

<h2>3. Third-Party Services</h2>
<p>The Service relies on the following third-party providers:</p>
<ul>
  <li><strong>GitHub</strong> — OAuth authentication</li>
  <li><strong>Stripe</strong> — subscription billing and payment processing</li>
  <li><strong>Alchemy</strong> — Ethereum and EVM blockchain data</li>
  <li><strong>CoinGecko &amp; Coinpaprika</strong> — cryptocurrency price feeds</li>
  <li><strong>GoPlus Security</strong> — token and address risk scoring</li>
  <li><strong>Chainabuse</strong> — community-reported scam address data</li>
  <li><strong>Turso</strong> — database hosting (encrypted at rest)</li>
  <li><strong>Render</strong> — web hosting and deployment</li>
</ul>
<p>
  Each of these providers has its own privacy policy. We share only the minimum data necessary
  for them to provide their service to us.
</p>

<h2>4. Data Sharing &amp; Disclosure</h2>
<p>We do <strong>not</strong> sell or rent your personal information.</p>
<p>We may share data only in these limited cases:</p>
<ul>
  <li>With the third-party providers listed above, as required to operate the Service</li>
  <li>To comply with valid legal requests (court order, subpoena, law enforcement request)</li>
  <li>To protect the rights, property, or safety of Almstins, our users, or the public</li>
</ul>
<p>We will notify you of legal requests unless prohibited by law or court order.</p>

<h2>5. Data Retention</h2>
<ul>
  <li>Account and wallet data is retained while your account is active</li>
  <li>You can request deletion of your account and all associated data at any time</li>
  <li>IP-based logs are retained for up to 12 months for abuse prevention</li>
  <li>Stripe retains billing records as required by their policies and applicable law</li>
</ul>

<h2>6. Security</h2>
<p>We use industry-standard practices including:</p>
<ul>
  <li>HTTPS on all connections</li>
  <li>Encrypted database storage (Turso)</li>
  <li>Secure session management</li>
  <li>Limited production data access</li>
</ul>
<p>
  No system is 100% secure. We cannot guarantee absolute security, and we are in beta —
  please do not store anything you would not be comfortable losing or having exposed.
</p>

<h2>7. Your Rights</h2>
<p>You may:</p>
<ul>
  <li>Request a copy of the data we hold about you</li>
  <li>Ask us to delete your account and all associated data</li>
  <li>Opt out of any future marketing communications</li>
  <li>If you are in the EU or UK: request data portability or lodge a complaint with your local data protection authority</li>
</ul>
<p>To exercise these rights, email us at the address below.</p>

<h2>8. Cookies</h2>
<p>
  We use only essential cookies — session tokens required to keep you logged in.
  We do not use advertising cookies or cross-site tracking.
</p>

<h2>9. Changes to This Policy</h2>
<p>
  We may update this policy. We will post the updated version here and change the "Last updated"
  date. Material changes will be communicated via the dashboard or email if you have one on file.
</p>

<h2>10. Contact</h2>
<p>Privacy questions or data requests: <a href="mailto:donnie@titaniumhut.com">donnie@titaniumhut.com</a></p>
<p>Thank you for using Almstins.</p>
`,
};

export const es: PrivacyLocale = {
  lang: 'es',
  summaryLabel: 'Política de Privacidad',
  ariaLabel: 'Política de Privacidad',
  body: `
<h1>Política de Privacidad</h1>
<p><strong>Última actualización: 31 de marzo de 2026</strong></p>

<p>
  Almstins («nosotros», «nos», «nuestro») opera almstins.com y los servicios relacionados (el «Servicio»).
  Esta política explica qué datos recopilamos, por qué, cómo los usamos y qué <strong>no</strong> hacemos con ellos.
</p>
<p>
  Esta política se aplica a todos los visitantes y usuarios — tengan o no una cuenta.
</p>

<h2>1. Información que recopilamos</h2>

<h3>Si solo visitas (sin cuenta)</h3>
<ul>
  <li>Dirección IP (usada solo para ubicación aproximada y prevención de abuso)</li>
  <li>Tipo de navegador, tipo de dispositivo, sistema operativo, preferencia de idioma</li>
  <li>Páginas visitadas, tiempo de permanencia y eventos básicos de interacción</li>
  <li>Fuente de referencia (de dónde llegaste)</li>
</ul>

<h3>Si creas una cuenta</h3>
<ul>
  <li>Dirección de correo electrónico (si se proporciona vía GitHub o directamente)</li>
  <li>Nombre e imagen de perfil (si los proporciona GitHub OAuth)</li>
  <li>ID interno de usuario y tokens de sesión</li>
  <li>Fecha de creación de la cuenta y último inicio de sesión</li>
</ul>

<h3>Si añades wallets o subes datos de transacciones</h3>
<ul>
  <li>Direcciones de wallet públicas que decides añadir</li>
  <li>Historial de transacciones on-chain obtenido para esas direcciones</li>
  <li>Datos CSV de transacciones que subes desde exchanges (p. ej. Crypto.com, Coinbase, Exodus)</li>
  <li>Etiquetas y apodos de cuentas de exchange que asignas</li>
</ul>

<h3>Si te suscribes (plan de pago)</h3>
<ul>
  <li>ID de cliente de Stripe y estado de la suscripción (no almacenamos los datos de la tarjeta)</li>
  <li>Correo de facturación y nombre (según se proporcionan a Stripe)</li>
</ul>

<p><strong>No</strong> recopilamos:</p>
<ul>
  <li>Private keys, seed phrases ni contraseñas de wallet — nunca</li>
  <li>Ubicación GPS precisa</li>
  <li>Historial de navegación fuera de almstins.com</li>
  <li>Números de tarjeta de pago (gestionados íntegramente por Stripe)</li>
</ul>

<h2>2. Cómo usamos tus datos</h2>
<ul>
  <li>Para operar, mostrar y mejorar tu panel y el seguimiento de tu portafolio</li>
  <li>Para autenticar tu cuenta y mantener segura tu sesión</li>
  <li>Para procesar los pagos de suscripción vía Stripe</li>
  <li>Para detectar y prevenir abuso, fraude o actividad maliciosa</li>
  <li>Para entender cómo se usa el Servicio (analíticas agregadas y anonimizadas)</li>
  <li>Para contactarte sobre problemas de seguridad o cambios importantes del Servicio (sin marketing sin consentimiento)</li>
</ul>

<p><strong>No</strong> hacemos lo siguiente:</p>
<ul>
  <li>Vender tus datos ni tus direcciones de wallet a nadie</li>
  <li>Compartir datos identificables con anunciantes</li>
  <li>Usar tus datos financieros para tomar decisiones o recomendaciones de inversión</li>
  <li>Enviar correos de marketing sin tu consentimiento explícito</li>
</ul>

<h2>3. Servicios de terceros</h2>
<p>El Servicio depende de los siguientes proveedores externos:</p>
<ul>
  <li><strong>GitHub</strong> — autenticación OAuth</li>
  <li><strong>Stripe</strong> — facturación de suscripciones y procesamiento de pagos</li>
  <li><strong>Alchemy</strong> — datos de blockchain de Ethereum y EVM</li>
  <li><strong>CoinGecko y Coinpaprika</strong> — feeds de precios de criptomonedas</li>
  <li><strong>GoPlus Security</strong> — puntuación de riesgo de tokens y direcciones</li>
  <li><strong>Chainabuse</strong> — datos de direcciones de estafa reportadas por la comunidad</li>
  <li><strong>Turso</strong> — alojamiento de base de datos (cifrada en reposo)</li>
  <li><strong>Render</strong> — alojamiento web y despliegue</li>
</ul>
<p>
  Cada uno de estos proveedores tiene su propia política de privacidad. Compartimos solo los datos mínimos
  necesarios para que nos presten su servicio.
</p>

<h2>4. Compartición y divulgación de datos</h2>
<p><strong>No</strong> vendemos ni alquilamos tu información personal.</p>
<p>Podemos compartir datos únicamente en estos casos limitados:</p>
<ul>
  <li>Con los proveedores externos enumerados arriba, según sea necesario para operar el Servicio</li>
  <li>Para cumplir solicitudes legales válidas (orden judicial, citación, requerimiento de las autoridades)</li>
  <li>Para proteger los derechos, la propiedad o la seguridad de Almstins, nuestros usuarios o el público</li>
</ul>
<p>Te notificaremos las solicitudes legales salvo que lo prohíba la ley o una orden judicial.</p>

<h2>5. Conservación de datos</h2>
<ul>
  <li>Los datos de cuenta y de wallets se conservan mientras tu cuenta esté activa</li>
  <li>Puedes solicitar la eliminación de tu cuenta y de todos los datos asociados en cualquier momento</li>
  <li>Los registros basados en IP se conservan hasta 12 meses para la prevención de abuso</li>
  <li>Stripe conserva los registros de facturación según lo exigen sus políticas y la ley aplicable</li>
</ul>

<h2>6. Seguridad</h2>
<p>Usamos prácticas estándar del sector, incluyendo:</p>
<ul>
  <li>HTTPS en todas las conexiones</li>
  <li>Almacenamiento de base de datos cifrado (Turso)</li>
  <li>Gestión segura de sesiones</li>
  <li>Acceso limitado a los datos de producción</li>
</ul>
<p>
  Ningún sistema es 100 % seguro. No podemos garantizar una seguridad absoluta, y estamos en beta —
  por favor, no almacenes nada que no estarías cómodo perdiendo o viendo expuesto.
</p>

<h2>7. Tus derechos</h2>
<p>Puedes:</p>
<ul>
  <li>Solicitar una copia de los datos que tenemos sobre ti</li>
  <li>Pedirnos que eliminemos tu cuenta y todos los datos asociados</li>
  <li>Darte de baja de cualquier comunicación de marketing futura</li>
  <li>Si estás en la UE o el Reino Unido: solicitar la portabilidad de datos o presentar una reclamación ante tu autoridad local de protección de datos</li>
</ul>
<p>Para ejercer estos derechos, escríbenos a la dirección de abajo.</p>

<h2>8. Cookies</h2>
<p>
  Usamos únicamente cookies esenciales — tokens de sesión necesarios para mantenerte con la sesión iniciada.
  No usamos cookies de publicidad ni rastreo entre sitios.
</p>

<h2>9. Cambios en esta política</h2>
<p>
  Podemos actualizar esta política. Publicaremos la versión actualizada aquí y cambiaremos la fecha de
  «Última actualización». Los cambios importantes se comunicarán a través del panel o por correo si tienes uno registrado.
</p>

<h2>10. Contacto</h2>
<p>Preguntas de privacidad o solicitudes de datos: <a href="mailto:donnie@titaniumhut.com">donnie@titaniumhut.com</a></p>
<p>Gracias por usar Almstins.</p>
`,
};

export const fr: PrivacyLocale = {
  lang: 'fr',
  summaryLabel: 'Politique de Confidentialité',
  ariaLabel: 'Politique de Confidentialité',
  body: `
<h1>Politique de Confidentialité</h1>
<p><strong>Dernière mise à jour : 31 mars 2026</strong></p>

<p>
  Almstins (« nous », « notre ») exploite almstins.com et les services connexes (le « Service »).
  La présente politique explique quelles données nous collectons, pourquoi, comment nous les utilisons et ce que
  nous ne faisons <strong>pas</strong> avec elles.
</p>
<p>
  La présente politique s’applique à tous les visiteurs et utilisateurs — que vous ayez un compte ou non.
</p>

<h2>1. Informations que nous collectons</h2>

<h3>Si vous ne faites que visiter (sans compte)</h3>
<ul>
  <li>Adresse IP (utilisée uniquement pour la localisation approximative et la prévention des abus)</li>
  <li>Type de navigateur, type d’appareil, système d’exploitation, préférence de langue</li>
  <li>Pages visitées, temps passé et événements d’interaction de base</li>
  <li>Source de référence (d’où vous venez)</li>
</ul>

<h3>Si vous créez un compte</h3>
<ul>
  <li>Adresse e-mail (si fournie via GitHub ou directement)</li>
  <li>Nom et photo de profil (si fournis par GitHub OAuth)</li>
  <li>Identifiant utilisateur interne et jetons de session</li>
  <li>Date de création du compte et dernière connexion</li>
</ul>

<h3>Si vous ajoutez des wallets ou téléversez des données de transactions</h3>
<ul>
  <li>Adresses de wallet publiques que vous choisissez d’ajouter</li>
  <li>Historique des transactions on-chain récupéré pour ces adresses</li>
  <li>Données CSV de transactions que vous téléversez depuis des exchanges (p. ex. Crypto.com, Coinbase, Exodus)</li>
  <li>Étiquettes et surnoms de comptes d’exchange que vous attribuez</li>
</ul>

<h3>Si vous vous abonnez (formule payante)</h3>
<ul>
  <li>Identifiant client Stripe et statut de l’abonnement (nous ne stockons pas les détails de la carte)</li>
  <li>E-mail et nom de facturation (tels que fournis à Stripe)</li>
</ul>

<p>Nous ne collectons <strong>pas</strong> :</p>
<ul>
  <li>Les private keys, seed phrases ou mots de passe de wallet — jamais</li>
  <li>La localisation GPS précise</li>
  <li>L’historique de navigation en dehors de almstins.com</li>
  <li>Les numéros de carte de paiement (entièrement gérés par Stripe)</li>
</ul>

<h2>2. Comment nous utilisons vos données</h2>
<ul>
  <li>Pour exploiter, afficher et améliorer votre tableau de bord et le suivi de votre portefeuille</li>
  <li>Pour authentifier votre compte et sécuriser votre session</li>
  <li>Pour traiter les paiements d’abonnement via Stripe</li>
  <li>Pour détecter et prévenir les abus, la fraude ou l’activité malveillante</li>
  <li>Pour comprendre comment le Service est utilisé (analyses agrégées et anonymisées)</li>
  <li>Pour vous contacter au sujet de problèmes de sécurité ou de changements majeurs du Service (aucun marketing sans consentement)</li>
</ul>

<p>Nous ne faisons <strong>pas</strong> ce qui suit :</p>
<ul>
  <li>Vendre vos données ou vos adresses de wallet à qui que ce soit</li>
  <li>Partager des données identifiables avec des annonceurs</li>
  <li>Utiliser vos données financières pour prendre des décisions ou des recommandations d’investissement</li>
  <li>Envoyer des e-mails de marketing sans votre consentement explicite</li>
</ul>

<h2>3. Services tiers</h2>
<p>Le Service s’appuie sur les prestataires tiers suivants :</p>
<ul>
  <li><strong>GitHub</strong> — authentification OAuth</li>
  <li><strong>Stripe</strong> — facturation des abonnements et traitement des paiements</li>
  <li><strong>Alchemy</strong> — données de blockchain Ethereum et EVM</li>
  <li><strong>CoinGecko et Coinpaprika</strong> — flux de prix des cryptomonnaies</li>
  <li><strong>GoPlus Security</strong> — évaluation du risque des tokens et des adresses</li>
  <li><strong>Chainabuse</strong> — données d’adresses d’arnaque signalées par la communauté</li>
  <li><strong>Turso</strong> — hébergement de base de données (chiffrée au repos)</li>
  <li><strong>Render</strong> — hébergement web et déploiement</li>
</ul>
<p>
  Chacun de ces prestataires a sa propre politique de confidentialité. Nous ne partageons que le minimum de données
  nécessaire pour qu’ils nous fournissent leur service.
</p>

<h2>4. Partage et divulgation des données</h2>
<p>Nous ne vendons ni ne louons <strong>pas</strong> vos informations personnelles.</p>
<p>Nous ne pouvons partager des données que dans ces cas limités :</p>
<ul>
  <li>Avec les prestataires tiers énumérés ci-dessus, dans la mesure nécessaire à l’exploitation du Service</li>
  <li>Pour répondre à des demandes légales valides (décision de justice, assignation, requête des forces de l’ordre)</li>
  <li>Pour protéger les droits, les biens ou la sécurité d’Almstins, de nos utilisateurs ou du public</li>
</ul>
<p>Nous vous informerons des demandes légales, sauf interdiction par la loi ou une décision de justice.</p>

<h2>5. Conservation des données</h2>
<ul>
  <li>Les données de compte et de wallet sont conservées tant que votre compte est actif</li>
  <li>Vous pouvez demander la suppression de votre compte et de toutes les données associées à tout moment</li>
  <li>Les journaux basés sur l’IP sont conservés jusqu’à 12 mois pour la prévention des abus</li>
  <li>Stripe conserve les enregistrements de facturation conformément à ses politiques et à la loi applicable</li>
</ul>

<h2>6. Sécurité</h2>
<p>Nous utilisons des pratiques conformes aux normes du secteur, notamment :</p>
<ul>
  <li>HTTPS sur toutes les connexions</li>
  <li>Stockage de base de données chiffré (Turso)</li>
  <li>Gestion sécurisée des sessions</li>
  <li>Accès limité aux données de production</li>
</ul>
<p>
  Aucun système n’est sûr à 100 %. Nous ne pouvons pas garantir une sécurité absolue, et nous sommes en bêta —
  veuillez ne rien stocker que vous ne seriez pas à l’aise de perdre ou de voir exposé.
</p>

<h2>7. Vos droits</h2>
<p>Vous pouvez :</p>
<ul>
  <li>Demander une copie des données que nous détenons à votre sujet</li>
  <li>Nous demander de supprimer votre compte et toutes les données associées</li>
  <li>Vous désinscrire de toute communication marketing future</li>
  <li>Si vous êtes dans l’UE ou au Royaume-Uni : demander la portabilité des données ou déposer une plainte auprès de votre autorité locale de protection des données</li>
</ul>
<p>Pour exercer ces droits, écrivez-nous à l’adresse ci-dessous.</p>

<h2>8. Cookies</h2>
<p>
  Nous n’utilisons que des cookies essentiels — des jetons de session nécessaires pour vous garder connecté.
  Nous n’utilisons pas de cookies publicitaires ni de suivi intersites.
</p>

<h2>9. Modifications de la présente politique</h2>
<p>
  Nous pouvons mettre à jour la présente politique. Nous publierons la version mise à jour ici et modifierons la
  date de « Dernière mise à jour ». Les changements importants seront communiqués via le tableau de bord ou par
  e-mail si vous en avez un enregistré.
</p>

<h2>10. Contact</h2>
<p>Questions de confidentialité ou demandes de données : <a href="mailto:donnie@titaniumhut.com">donnie@titaniumhut.com</a></p>
<p>Merci d’utiliser Almstins.</p>
`,
};

const MAP: Record<Lang, PrivacyLocale> = { en, es, fr };

/** Select the Privacy locale for a language, falling back to English. */
export function getPrivacy(lang: Lang): PrivacyLocale {
  return MAP[lang] ?? en;
}
