export interface LoginPageLocale {
  lang: 'en' | 'es' | 'fr';
  hub: {
    eyebrow: string;
    title: string;
    sub: string;
    heroFree: string;
    heroCta: string;
    doorsAria: string;
    trustAria: string;
    trust1: string;
    trust2: string;
    checker: { title: string; desc: string; free: string; cta: string };
    verify:  { title: string; desc: string; free: string; cta: string };
    watcher: { title: string; desc: string; free: string; cta: string };
    plansLink: string;
    plansHref: string;  // language-aware: /prices · /prices/es · /prices/fr
  };
  meta: { title: string; description: string };
  signin: {
    pillLabel: string;
    closeAriaLabel: string;
    continueDashboard: string;
    noSignupPrimary: string;
    noSignupSub: string;
    continueGoogle: string;
    continueGithub: string;
    lastUsed: string;
    emailToggleLabel: string;
    tabPassword: string;
    tabMagicLink: string;
    emailLabel: string;
    emailPlaceholder: string;
    passwordLabel: string;
    signInEmail: string;
    sendMagicLink: string;
  };
  hero: {
    wordmarkAriaLabel: string;
    headline: string;          // may contain <br/> — rendered with set:html
    subheadline: string;
    demoCta: string;
    demoCtaSub: string;
    showProductHunt: boolean;
    walletSectionLabel: string;
    walletPlaceholder: string;
    walletAriaLabel: string;
    walletButtonAriaLabel: string;
    walletHint: string;
    walletErrorHint: string;
    checkerLabel: string;
    checkerHint: string;
    changelogLink: string;
    socialProof: string;
    eyebrow: string;
    safetyHeadline: string;
    safetySub: string;
    chipSite: string;
    chipAddress: string;
    chipApprovals: string;
    trustLine: string;
    router: {
      check:  { title: string; desc: string; tag: string };
      track:  { title: string; desc: string; tag: string };
      verify: { title: string; desc: string; tag: string };
    };
  };
  featureCards: Array<{
    icon: string;
    title: string;
    desc: string;  // may contain HTML — rendered with set:html
  }>;
  hesitationModal: {
    title: string;
    body: string;
    cta: string;
    closeAriaLabel: string;
  };
  sessionPopup: {
    title: string;
    body: string;
    signOutBtn: string;
    dismissBtn: string;
  };
  errors: {
    configuration: string;
    generic: string;
  };
  notices: {
    signupSuccess: string;
    verifiedSuccess: string;
    verifiedExpired: string;
    verifiedFailed: string;
  };
}

export const en: LoginPageLocale = {
  lang: 'en',
  hub: {
    eyebrow: 'One hub · three tools',
    title: 'Use crypto without the guesswork.',
    sub: 'Check an address before you send, account for everything you own, and verify the QR codes your business publishes — all in one place. Read-only, no wallet connection.',
    heroFree: 'Scanning for security is free for everyone. No account, no sign-in needed.',
    heroCta: 'Start with the free checker',
    doorsAria: 'Almstins tools',
    trustAria: 'Our trust guarantees',
    trust1: 'Your keys never touch our server',
    trust2: 'No wallet connection, ever',
    checker: { title: 'Wallet Checker', desc: 'Paste or scan any wallet address or website — instant scam, phishing, honeypot, and sanctions check.', free: 'Free · No account · No sign-in', cta: 'Open the checker' },
    verify:  { title: 'Verify', desc: 'Register the receiving addresses you publish and catch a swapped QR before a customer pays the wrong one.', free: 'Free: 1 reusable QR connection. Need more? Upgrade.', cta: 'Go to Verify' },
    watcher: { title: 'Wallet Watcher', desc: 'Track wallets, exchanges, and DeFi by address — cost basis, realized gains, and a clear year-end breakdown for your accountant.', free: 'Free tier · Sign in with email, Google, or GitHub · We only store your email', cta: 'Try the demo' },
    plansLink: 'See all plans & pricing',
    plansHref: '/prices',
  },
  meta: {
    title: 'Almstins — Check, track, and verify your crypto',
    description: 'Check any wallet or site for scams, track your portfolio and taxes, and verify the QR codes your business publishes — read-only, no wallet connection.',
  },
  signin: {
    pillLabel: 'Login',
    closeAriaLabel: 'Close sign-in panel',
    continueDashboard: 'Continue to Dashboard →',
    noSignupPrimary: 'Sign in to get started.',
    noSignupSub: "We'll create your account on your first sign-in.",
    continueGoogle: 'Continue with Google',
    continueGithub: 'Continue with GitHub',
    lastUsed: 'Last used',
    emailToggleLabel: 'Sign in with email',
    tabPassword: 'Password',
    tabMagicLink: 'Magic link',
    emailLabel: 'Email address',
    emailPlaceholder: 'you@example.com',
    passwordLabel: 'Password',
    signInEmail: 'Sign in with email',
    sendMagicLink: 'Send magic link',
  },
  hero: {
    wordmarkAriaLabel: 'Almstins home',
    headline: 'Finally Understand<br/>What Happened<br/>in Your Wallet.',
    subheadline: 'Missing transactions, unexplained gaps, tax surprises — trace every move in your crypto history so you know exactly what happened and why.',
    demoCta: 'Try the Demo — No Signup Needed →',
    demoCtaSub: 'Explore a real portfolio with DeFi positions, tax gaps, and wallet history.',
    showProductHunt: true,
    walletSectionLabel: 'Or enter your own wallet address',
    walletPlaceholder: '0x… or ENS name',
    walletAriaLabel: 'Wallet address',
    walletButtonAriaLabel: 'Go',
    walletHint: 'See transactions, flagged gaps, and what the IRS will ask about. No signup needed.',
    walletErrorHint: '⚠ Wallet not recognized — try an Ethereum (0x…), Bitcoin, or Solana address.',
    checkerLabel: 'Check any wallet or website — free, no signup',
    checkerHint: 'Scan a QR or paste an address/URL — screened against scam blacklists, OFAC sanctions, honeypots, and 345,000+ phishing domains.',
    changelogLink: "What's new →",
    socialProof: '345,000+ phishing domains checked · OFAC sanctions screening · 6+ chains, every major exchange.',
    eyebrow: 'Free · No signup · No wallet connection',
    safetyHeadline: 'Know it\'s safe before you send.',
    safetySub: 'Scan a QR or paste any wallet address or website — we screen it against the major scam, phishing, and sanctions databases before you act.',
    chipSite: 'Check a site',
    chipAddress: 'Check an address',
    chipApprovals: 'Revoke approvals',
    trustLine: 'Read-only · No private keys · No wallet connection · No custody',
    router: {
      check:  { title: 'Check',  desc: 'Know it\'s safe before you send.',  tag: 'Free · no login' },
      track:  { title: 'Track',  desc: 'Understand what\'s in your wallet.', tag: 'Cost basis · gains · tax' },
      verify: { title: 'Verify', desc: 'Your customers are checking your QR — do you know what\'s there?', tag: 'For businesses' },
    },
  },
  featureCards: [
    {
      icon: '🔐',
      title: 'Your keys never touch our server. Ever.',
      desc: "Almstins reads balances by address — no wallet connection, no signing permissions, no private keys. A breach of our servers can't move a single coin. <a href=\"/login#faq-private-account\" class=\"fc-anon-link\" onclick=\"event.preventDefault();document.getElementById('faq-private-account')?.click()\">Learn how to stay anonymous on our platform →</a>",
    },
    {
      icon: '🔍',
      title: 'Know your tax exposure',
      desc: 'The demo portfolio is $57,680 across BTC, ETH, SOL, and AVAX — with unrealized gains calculated, missing cost basis flagged, and every position labeled short-term or long-term hold.',
    },
    {
      icon: '🏫',
      title: 'Built by a teacher',
      desc: 'Privacy-first from day one. Never sold. Never shared.',
    },
  ],
  hesitationModal: {
    title: 'See it live — no signup needed',
    body: 'Explore a real portfolio with DeFi positions, tax gaps, and wallet history.',
    cta: 'Launch Demo',
    closeAriaLabel: 'Close',
  },
  sessionPopup: {
    title: "You're already signed in",
    body: 'It looks like you have an active session on another browser or device. Sign out first, then try again.',
    signOutBtn: 'Sign out & try again',
    dismissBtn: 'Dismiss',
  },
  errors: {
    configuration: 'Sign-in is temporarily unavailable. Please try again in a moment.',
    generic: 'Sign-in failed. Please try again.',
  },
  notices: {
    signupSuccess: 'Account created. Check your inbox to verify your email.',
    verifiedSuccess: 'Email verified. You can sign in now.',
    verifiedExpired: 'Verification link expired. Please sign in to request a new one.',
    verifiedFailed: 'Verification failed. Please try again.',
  },
};

export const es: LoginPageLocale = {
  lang: 'es',
  hub: {
    eyebrow: 'Un centro · tres herramientas',
    title: 'Usa cripto sin adivinar.',
    sub: 'Comprueba una dirección antes de enviar, contabiliza todo lo que tienes y verifica los códigos QR que publica tu negocio — todo en un solo lugar. Solo lectura, sin conectar la billetera.',
    heroFree: 'Escanear por seguridad es gratis para todos. Sin cuenta, sin iniciar sesión.',
    heroCta: 'Empieza con el verificador gratis',
    doorsAria: 'Herramientas de Almstins',
    trustAria: 'Nuestras garantías de confianza',
    trust1: 'Tus llaves nunca tocan nuestro servidor',
    trust2: 'Sin conectar la billetera, nunca',
    checker: { title: 'Wallet Checker', desc: 'Pega o escanea cualquier dirección de billetera o sitio web — comprobación instantánea de estafas, phishing, honeypots y sanciones.', free: 'Gratis · Sin cuenta · Sin iniciar sesión', cta: 'Abrir el verificador' },
    verify:  { title: 'Verify', desc: 'Registra las direcciones de cobro que publicas y detecta un QR cambiado antes de que un cliente pague al equivocado.', free: 'Gratis: 1 conexión QR reutilizable. ¿Necesitas más? Mejora tu plan.', cta: 'Ir a Verify' },
    watcher: { title: 'Wallet Watcher', desc: 'Rastrea billeteras, exchanges y DeFi por dirección — base de costo, ganancias realizadas y un desglose de fin de año claro para tu contador.', free: 'Plan gratis · Inicia sesión con correo, Google o GitHub · Solo guardamos tu correo', cta: 'Probar la demo' },
    plansLink: 'Ver todos los planes y precios',
    plansHref: '/prices/es',
  },
  meta: {
    title: 'Almstins — Comprueba, rastrea y verifica tu cripto',
    description: 'Comprueba cualquier billetera o sitio por estafas, rastrea tu portafolio e impuestos, y verifica los códigos QR que publica tu negocio — solo lectura, sin conectar la billetera.',
  },
  signin: {
    pillLabel: 'Iniciar sesión',
    closeAriaLabel: 'Cerrar panel',
    continueDashboard: 'Ir al panel →',
    noSignupPrimary: 'Inicia sesión para empezar.',
    noSignupSub: 'Creamos tu cuenta en tu primer inicio de sesión.',
    continueGoogle: 'Continuar con Google',
    continueGithub: 'Continuar con GitHub',
    lastUsed: 'Último usado',
    emailToggleLabel: 'Iniciar sesión con email',
    tabPassword: 'Contraseña',
    tabMagicLink: 'Enlace mágico',
    emailLabel: 'Correo electrónico',
    emailPlaceholder: 'tu@ejemplo.com',
    passwordLabel: 'Contraseña',
    signInEmail: 'Iniciar sesión con email',
    sendMagicLink: 'Enviar enlace mágico',
  },
  hero: {
    wordmarkAriaLabel: 'Almstins inicio',
    headline: 'Por fin entiende<br/>qué pasó en<br/>tu billetera.',
    subheadline: 'Transacciones perdidas, brechas inexplicables, sorpresas fiscales — rastrea cada movimiento en tu historial crypto para saber exactamente qué pasó y por qué.',
    demoCta: 'Prueba el Demo — Sin Registro →',
    demoCtaSub: 'Explora un portafolio real con posiciones DeFi, brechas fiscales e historial de billetera.',
    showProductHunt: false,
    walletSectionLabel: 'O ingresa tu propia dirección de billetera',
    walletPlaceholder: '0x… o dirección',
    walletAriaLabel: 'Dirección de billetera',
    walletButtonAriaLabel: 'Ir',
    walletHint: 'Ve transacciones, brechas marcadas y lo que el fisco te preguntará. Sin registro.',
    walletErrorHint: '⚠ Dirección no reconocida — prueba una dirección Ethereum (0x…), Bitcoin o Solana.',
    checkerLabel: 'Verifica cualquier billetera o sitio web — gratis, sin registro',
    checkerHint: 'Escanea un QR o pega una dirección/URL — revisada contra listas negras de estafas, sanciones OFAC, honeypots y más de 345.000 dominios de phishing.',
    changelogLink: '¿Qué hay de nuevo? →',
    socialProof: '345,000+ dominios de phishing · Verificación OFAC · 6+ redes y exchanges principales.',
    eyebrow: 'Gratis · Sin registro · Sin conectar tu billetera',
    safetyHeadline: 'Confirma que es seguro antes de enviar.',
    safetySub: 'Escanea un QR o pega cualquier dirección o sitio web — lo revisamos contra las principales bases de datos de estafas, phishing y sanciones antes de que actúes.',
    chipSite: 'Comprueba un sitio',
    chipAddress: 'Comprueba una dirección',
    chipApprovals: 'Revoca permisos',
    trustLine: 'Solo lectura · Sin llaves privadas · Sin conectar billetera · Sin custodia',
    router: {
      check:  { title: 'Comprueba', desc: 'Confirma que es seguro antes de enviar.', tag: 'Gratis · sin registro' },
      track:  { title: 'Rastrea',   desc: 'Entiende qué hay en tu billetera.',        tag: 'Costo base · ganancias · impuestos' },
      verify: { title: 'Verify',    desc: 'Tus clientes escanean tu QR — ¿sabes qué contiene?', tag: 'Para negocios' },
    },
  },
  featureCards: [
    {
      icon: '🔐',
      title: 'Solo lectura, siempre',
      desc: 'Solo direcciones públicas. Sin claves, sin riesgo — nunca.',
    },
    {
      icon: '🔍',
      title: 'Conoce tu exposición fiscal',
      desc: 'Cada ganancia, brecha marcada y base de costo faltante — antes de que llegue el fisco.',
    },
    {
      icon: '🏫',
      title: 'Hecho por un educador',
      desc: 'Privacidad desde el primer día. Nunca vendido. Nunca compartido.',
    },
  ],
  hesitationModal: {
    title: 'Míralo en acción — sin registro',
    body: 'Explora un portafolio real con posiciones DeFi, brechas fiscales e historial de billetera.',
    cta: 'Lanzar Demo',
    closeAriaLabel: 'Cerrar',
  },
  sessionPopup: {
    title: 'Ya tienes una sesión activa',
    body: 'Parece que tienes una sesión activa en otro navegador o dispositivo. Cierra sesión primero y vuelve a intentarlo.',
    signOutBtn: 'Cerrar sesión e intentar de nuevo',
    dismissBtn: 'Descartar',
  },
  errors: {
    configuration: 'El inicio de sesión no está disponible temporalmente. Por favor intenta de nuevo.',
    generic: 'Error al iniciar sesión. Por favor intenta de nuevo.',
  },
  notices: {
    signupSuccess: 'Cuenta creada. Revisa tu bandeja de entrada para verificar tu email.',
    verifiedSuccess: 'Email verificado. Ya puedes iniciar sesión.',
    verifiedExpired: 'El enlace de verificación expiró. Inicia sesión para solicitar uno nuevo.',
    verifiedFailed: 'La verificación falló. Por favor intenta de nuevo.',
  },
};

export const fr: LoginPageLocale = {
  lang: 'fr',
  hub: {
    eyebrow: 'Un hub · trois outils',
    title: 'Utilisez la crypto sans deviner.',
    sub: 'Vérifiez une adresse avant d\'envoyer, comptabilisez tout ce que vous possédez et vérifiez les QR codes que votre entreprise publie — le tout au même endroit. Lecture seule, aucune connexion de portefeuille.',
    heroFree: 'L\'analyse de sécurité est gratuite pour tous. Aucun compte, aucune connexion requise.',
    heroCta: 'Commencez avec le vérificateur gratuit',
    doorsAria: 'Outils Almstins',
    trustAria: 'Nos garanties de confiance',
    trust1: 'Vos clés ne touchent jamais notre serveur',
    trust2: 'Aucune connexion de portefeuille, jamais',
    checker: { title: 'Wallet Checker', desc: 'Collez ou scannez n\'importe quelle adresse de portefeuille ou site web — vérification instantanée des arnaques, du phishing, des honeypots et des sanctions.', free: 'Gratuit · Sans compte · Sans connexion', cta: 'Ouvrir le vérificateur' },
    verify:  { title: 'Verify', desc: 'Enregistrez les adresses de réception que vous publiez et détectez un QR substitué avant qu\'un client ne paie la mauvaise.', free: 'Gratuit : 1 connexion QR réutilisable. Besoin de plus ? Améliorez votre offre.', cta: 'Aller à Verify' },
    watcher: { title: 'Wallet Watcher', desc: 'Suivez portefeuilles, plateformes d\'échange et DeFi par adresse — prix de revient, gains réalisés et un récapitulatif de fin d\'année clair pour votre comptable.', free: 'Offre gratuite · Connectez-vous par e-mail, Google ou GitHub · Nous ne stockons que votre e-mail', cta: 'Essayer la démo' },
    plansLink: 'Voir tous les forfaits et tarifs',
    plansHref: '/prices/fr',
  },
  meta: {
    title: 'Almstins — Contrôlez, suivez et vérifiez votre crypto',
    description: 'Vérifiez une adresse ou un site contre les arnaques, suivez votre portefeuille et vos impôts, et protégez vos QR codes de paiement — lecture seule, sans connexion de portefeuille.',
  },
  signin: {
    pillLabel: 'Connexion',
    closeAriaLabel: 'Fermer le panneau de connexion',
    continueDashboard: 'Continuer vers le tableau de bord →',
    noSignupPrimary: 'Connectez-vous pour commencer.',
    noSignupSub: 'Nous créons votre compte lors de votre première connexion.',
    continueGoogle: 'Continuer avec Google',
    continueGithub: 'Continuer avec GitHub',
    lastUsed: 'Dernière utilisation',
    emailToggleLabel: 'Se connecter par email',
    tabPassword: 'Mot de passe',
    tabMagicLink: 'Lien magique',
    emailLabel: 'Adresse email',
    emailPlaceholder: 'vous@exemple.com',
    passwordLabel: 'Mot de passe',
    signInEmail: 'Se connecter par email',
    sendMagicLink: 'Envoyer un lien magique',
  },
  hero: {
    wordmarkAriaLabel: 'Accueil Almstins',
    headline: 'Comprendre enfin<br/>ce qui s\'est passé<br/>dans votre portefeuille.',
    subheadline: 'Transactions manquantes, lacunes inexplicables, surprises fiscales — tracez chaque mouvement de votre historique crypto pour savoir exactement ce qui s\'est passé et pourquoi.',
    demoCta: 'Essayer la démo — Aucune inscription requise →',
    demoCtaSub: 'Explorez un portefeuille réel avec des positions DeFi, des lacunes fiscales et un historique de portefeuille.',
    showProductHunt: false,
    walletSectionLabel: 'Ou entrez votre propre adresse de portefeuille',
    walletPlaceholder: '0x… ou nom ENS',
    walletAriaLabel: 'Adresse du portefeuille',
    walletButtonAriaLabel: 'Aller',
    walletHint: 'Voir les transactions, les lacunes signalées et ce que l\'IRS demandera. Aucune inscription requise.',
    walletErrorHint: '⚠ Adresse non reconnue — essayez une adresse Ethereum (0x…), Bitcoin ou Solana.',
    checkerLabel: 'Vérifiez n\'importe quel portefeuille ou site web — gratuit, sans inscription',
    checkerHint: 'Scannez un QR ou collez une adresse/URL — vérifiée contre les listes noires d\'arnaques, les sanctions OFAC, les honeypots et plus de 345 000 domaines de phishing.',
    changelogLink: 'Quoi de neuf ? →',
    socialProof: '345 000+ domaines de phishing vérifiés · Vérification des sanctions OFAC · 6+ chaînes et principaux échanges.',
    eyebrow: 'Gratuit · Sans inscription · Sans connexion de portefeuille',
    safetyHeadline: 'Vérifiez que c\'est sûr avant d\'envoyer.',
    safetySub: 'Scannez un QR ou collez n\'importe quelle adresse ou site web — nous le vérifions dans les principales bases de données d\'arnaques, de phishing et de sanctions avant que vous n\'agissiez.',
    chipSite: 'Vérifier un site',
    chipAddress: 'Vérifier une adresse',
    chipApprovals: 'Révoquer les autorisations',
    trustLine: 'Lecture seule · Pas de clés privées · Pas de connexion de portefeuille · Pas de garde',
    router: {
      check:  { title: 'Vérifier', desc: 'Vérifiez que c\'est sûr avant d\'envoyer.', tag: 'Gratuit · sans inscription' },
      track:  { title: 'Suivre',   desc: 'Comprenez ce qu\'il y a dans votre portefeuille.', tag: 'Prix de revient · gains · impôts' },
      verify: { title: 'Verify',   desc: 'Vos clients scannent votre QR — savez-vous ce qu\'il contient ?', tag: 'Pour les entreprises' },
    },
  },
  featureCards: [
    {
      icon: '🔐',
      title: 'Vos clés ne touchent jamais notre serveur. Jamais.',
      desc: 'Almstins lit les soldes par adresse — pas de connexion de portefeuille, pas de permissions de signature, pas de clés privées. Une violation de nos serveurs ne peut pas déplacer une seule pièce. <a href="/login#faq-private-account" class="fc-anon-link" onclick="event.preventDefault();document.getElementById(\'faq-private-account\')?.click()">Découvrez comment rester anonyme sur notre plateforme →</a>',
    },
    {
      icon: '🔍',
      title: 'Connaître votre exposition fiscale',
      desc: 'Le portefeuille de démonstration est de 57 680 $ entre BTC, ETH, SOL et AVAX — avec gains non réalisés calculés, base de coûts manquante signalée et chaque position étiquetée détention à court ou long terme.',
    },
    {
      icon: '🏫',
      title: 'Construit par un éducateur',
      desc: 'Confidentialité en priorité depuis le premier jour. Jamais vendu. Jamais partagé.',
    },
  ],
  hesitationModal: {
    title: 'Voyez-le en direct — aucune inscription requise',
    body: 'Explorez un portefeuille réel avec des positions DeFi, des lacunes fiscales et un historique de portefeuille.',
    cta: 'Lancer la démo',
    closeAriaLabel: 'Fermer',
  },
  sessionPopup: {
    title: 'Vous êtes déjà connecté',
    body: 'Il semble que vous ayez une session active sur un autre navigateur ou appareil. Déconnectez-vous d\'abord, puis réessayez.',
    signOutBtn: 'Se déconnecter et réessayer',
    dismissBtn: 'Ignorer',
  },
  errors: {
    configuration: 'La connexion n\'est temporairement pas disponible. Veuillez réessayer dans un moment.',
    generic: 'La connexion a échoué. Veuillez réessayer.',
  },
  notices: {
    signupSuccess: 'Compte créé. Vérifiez votre boîte de réception pour vérifier votre email.',
    verifiedSuccess: 'Email vérifié. Vous pouvez maintenant vous connecter.',
    verifiedExpired: 'Le lien de vérification a expiré. Connectez-vous pour en demander un nouveau.',
    verifiedFailed: 'La vérification a échoué. Veuillez réessayer.',
  },
};
