export interface LoginPageLocale {
  lang: 'en' | 'es' | 'fr';
  meta: { title: string; description: string };
  langToggle: { text: string; href: string; ariaLabel: string };
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
    changelogLink: string;
    socialProof: string;
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
  meta: {
    title: 'Almstins — Know Exactly What You Own',
    description: 'Trace every transaction in your crypto history. Missing cost basis, unexplained gaps, and tax surprises — surfaced in one place. No signup needed to explore.',
  },
  langToggle: { text: '🇪🇸 En Español', href: '/es', ariaLabel: 'Ver en español' },
  signin: {
    pillLabel: 'Login',
    closeAriaLabel: 'Close sign-in panel',
    continueDashboard: 'Continue to Dashboard →',
    noSignupPrimary: 'No signup needed — just sign in.',
    noSignupSub: "We'll create your account automatically the first time.",
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
    changelogLink: "What's new →",
    socialProof: '345,000+ phishing domains checked · OFAC sanctions screening · 6+ chains, every major exchange.',
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
  meta: {
    title: 'Almstins — Por fin entiende qué pasó en tu billetera',
    description: 'Rastrea cada transacción en tu historial crypto. Transacciones perdidas, brechas inexplicables y sorpresas fiscales — todo en un solo lugar. Sin registro para explorar.',
  },
  langToggle: { text: '🇺🇸 In English', href: '/', ariaLabel: 'Switch to English' },
  signin: {
    pillLabel: 'Iniciar sesión',
    closeAriaLabel: 'Cerrar panel',
    continueDashboard: 'Ir al panel →',
    noSignupPrimary: 'Sin registro — solo inicia sesión.',
    noSignupSub: 'Creamos tu cuenta automáticamente la primera vez.',
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
    changelogLink: '¿Qué hay de nuevo? →',
    socialProof: '345,000+ dominios de phishing · Verificación OFAC · 6+ redes y exchanges principales.',
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
  meta: {
    title: 'Almstins — Comprendre exactement ce que vous possédez',
    description: 'Tracez chaque transaction de votre historique crypto. Transactions manquantes, lacunes inexplicables et surprises fiscales — tout en un seul endroit. Aucune inscription nécessaire pour explorer.',
  },
  langToggle: { text: '🇺🇸 In English', href: '/', ariaLabel: 'Passer à l\'anglais' },
  signin: {
    pillLabel: 'Connexion',
    closeAriaLabel: 'Fermer le panneau de connexion',
    continueDashboard: 'Continuer vers le tableau de bord →',
    noSignupPrimary: 'Aucune inscription nécessaire — connectez-vous simplement.',
    noSignupSub: 'Nous créerons votre compte automatiquement la première fois.',
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
    changelogLink: 'Quoi de neuf ? →',
    socialProof: '345 000+ domaines de phishing vérifiés · Vérification des sanctions OFAC · 6+ chaînes et principaux échanges.',
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
