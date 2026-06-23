// Business-owner (Verify) drip — a 4-email series (EN · ES · FR), founder-voiced.
//
// Enrolled when a user registers their first Verify destination (onboardingDrip:
// enrollBusiness). Honest about monitoring being early-access. Shares dripTemplate
// (Telegram + reply footer, unsubscribe). Cadence day 0 / 2 / 5 / 10.

import type { Lang } from '@/lib/i18n/locale';
import type { DripLocale } from './dripTemplate';

export const en: DripLocale = {
  lang: 'en',
  brand: 'Almstins',
  signoff: '— Donnie',
  unsubscribe: 'Unsubscribe from these emails',
  contact: 'Reply any time, or message me on Telegram',
  emails: [
    {
      subject: 'You registered your first address — now prove it’s yours',
      paragraphs: [
        'You just registered a payment address with Almstins Verify. That’s the foundation: Almstins now knows your real receiving address, so you can check any sign or QR against it before you trust it.',
        'The next step makes it count for your customers too — prove you control the domain you publish on. A quick signature or a small file on your site, no wallet connection and no keys, and your published address carries your domain behind it.',
      ],
      ctaLabel: 'Prove your domain',
      ctaPath: '/dashboard/verify',
    },
    {
      subject: 'On-chain, there’s no chargeback',
      paragraphs: [
        'If a card payment goes wrong, you call the bank. On-chain, the money is simply gone — no chargeback, no one to call. So the defense has to happen before the send, not after.',
        'The habit that protects you: check your own published address before you trust it. Scan or paste any sign and Verify tells you instantly whether it still matches what you registered. Free, as often as you need.',
      ],
      ctaLabel: 'Check a published address',
      ctaPath: '/wallet-checker',
    },
    {
      subject: 'Let your customers verify before they pay you',
      paragraphs: [
        'A swapped QR looks identical to the real one — same sticker, different address. The fix isn’t a better sticker; it’s letting your customer confirm, before they send, that the address is really yours.',
        'Once your domain is proven, anyone can check a published address and see that you published it. It turns “I hope this is right” into “I checked.”',
      ],
      ctaLabel: 'See how it works',
      ctaPath: '/verify',
    },
    {
      subject: 'When you’re ready to watch more',
      paragraphs: [
        'Automatic monitoring — we keep watching your published addresses and alert you the moment one changes — is rolling out, free during early access.',
        'And if you publish many addresses, run several locations, or you’re an exchange wanting your users to verify your official deposit addresses before they send, that’s a conversation. Just reply to this email, or message me on Telegram.',
      ],
      ctaLabel: 'Explore Verify',
      ctaPath: '/verify',
    },
  ],
};

export const es: DripLocale = {
  lang: 'es',
  brand: 'Almstins',
  signoff: '— Donnie',
  unsubscribe: 'Darse de baja de estos correos',
  contact: 'Responde cuando quieras, o escríbeme por Telegram',
  emails: [
    {
      subject: 'Registraste tu primera dirección — ahora demuestra que es tuya',
      paragraphs: [
        'Acabas de registrar una dirección de pago con Almstins Verify. Esa es la base: Almstins ahora conoce tu dirección de cobro real, así que puedes comprobar cualquier letrero o QR contra ella antes de fiarte.',
        'El siguiente paso hace que también cuente para tus clientes: demuestra que controlas el dominio donde publicas. Una firma rápida o un pequeño archivo en tu sitio, sin conectar la billetera y sin claves, y tu dirección publicada lleva tu dominio detrás.',
      ],
      ctaLabel: 'Demostrar tu dominio',
      ctaPath: '/dashboard/verify',
    },
    {
      subject: 'En la cadena no hay contracargo',
      paragraphs: [
        'Si un pago con tarjeta sale mal, llamas al banco. En la cadena, el dinero simplemente desaparece — sin contracargo, sin nadie a quien llamar. Por eso la defensa tiene que ocurrir antes del envío, no después.',
        'El hábito que te protege: comprueba tu propia dirección publicada antes de fiarte. Escanea o pega cualquier letrero y Verify te dice al instante si sigue coincidiendo con lo que registraste. Gratis, tantas veces como necesites.',
      ],
      ctaLabel: 'Comprobar una dirección publicada',
      ctaPath: '/wallet-checker',
    },
    {
      subject: 'Deja que tus clientes verifiquen antes de pagarte',
      paragraphs: [
        'Un QR sustituido se ve idéntico al real — la misma calcomanía, otra dirección. La solución no es una mejor calcomanía; es dejar que tu cliente confirme, antes de enviar, que la dirección es realmente tuya.',
        'Una vez que tu dominio está demostrado, cualquiera puede comprobar una dirección publicada y ver que la publicaste tú. Convierte el “espero que esté bien” en “lo comprobé”.',
      ],
      ctaLabel: 'Ver cómo funciona',
      ctaPath: '/verify',
    },
    {
      subject: 'Cuando estés listo para vigilar más',
      paragraphs: [
        'La supervisión automática — seguimos vigilando tus direcciones publicadas y te avisamos en cuanto una cambia — está llegando, gratis durante el acceso anticipado.',
        'Y si publicas muchas direcciones, manejas varios locales, o eres un exchange que quiere que sus usuarios verifiquen tus direcciones de depósito oficiales antes de enviar, eso es una conversación. Solo responde a este correo, o escríbeme por Telegram.',
      ],
      ctaLabel: 'Explorar Verify',
      ctaPath: '/verify',
    },
  ],
};

export const fr: DripLocale = {
  lang: 'fr',
  brand: 'Almstins',
  signoff: '— Donnie',
  unsubscribe: 'Se désabonner de ces e-mails',
  contact: 'Répondez quand vous voulez, ou écrivez-moi sur Telegram',
  emails: [
    {
      subject: 'Vous avez enregistré votre première adresse — prouvez maintenant qu’elle est à vous',
      paragraphs: [
        'Vous venez d’enregistrer une adresse de paiement avec Almstins Verify. C’est la base : Almstins connaît désormais votre adresse de réception réelle, vous pouvez donc vérifier n’importe quel panneau ou QR par rapport à elle avant de vous y fier.',
        'L’étape suivante la rend utile pour vos clients aussi : prouvez que vous contrôlez le domaine sur lequel vous publiez. Une signature rapide ou un petit fichier sur votre site, sans connexion de portefeuille ni clés, et votre adresse publiée porte votre domaine derrière elle.',
      ],
      ctaLabel: 'Prouver votre domaine',
      ctaPath: '/dashboard/verify',
    },
    {
      subject: 'Sur la chaîne, il n’y a pas de rétrofacturation',
      paragraphs: [
        'Si un paiement par carte tourne mal, vous appelez la banque. Sur la chaîne, l’argent a tout simplement disparu — pas de rétrofacturation, personne à appeler. La défense doit donc se faire avant l’envoi, pas après.',
        'L’habitude qui vous protège : vérifiez votre propre adresse publiée avant de vous y fier. Scannez ou collez n’importe quel panneau et Verify vous dit aussitôt si elle correspond toujours à ce que vous avez enregistré. Gratuit, aussi souvent que nécessaire.',
      ],
      ctaLabel: 'Vérifier une adresse publiée',
      ctaPath: '/wallet-checker',
    },
    {
      subject: 'Laissez vos clients vérifier avant de vous payer',
      paragraphs: [
        'Un QR remplacé est identique au vrai — même autocollant, adresse différente. La solution n’est pas un meilleur autocollant ; c’est de laisser votre client confirmer, avant d’envoyer, que l’adresse est bien la vôtre.',
        'Une fois votre domaine prouvé, n’importe qui peut vérifier une adresse publiée et constater que c’est vous qui l’avez publiée. Cela transforme « j’espère que c’est correct » en « j’ai vérifié ».',
      ],
      ctaLabel: 'Voir comment ça marche',
      ctaPath: '/verify',
    },
    {
      subject: 'Quand vous serez prêt à surveiller davantage',
      paragraphs: [
        'La surveillance automatique — nous continuons de surveiller vos adresses publiées et vous alertons dès qu’une change — arrive bientôt, gratuite pendant l’accès anticipé.',
        'Et si vous publiez de nombreuses adresses, gérez plusieurs sites, ou êtes un exchange qui veut que ses utilisateurs vérifient vos adresses de dépôt officielles avant d’envoyer, c’est une conversation. Répondez simplement à cet e-mail, ou écrivez-moi sur Telegram.',
      ],
      ctaLabel: 'Découvrir Verify',
      ctaPath: '/verify',
    },
  ],
};

const MAP: Record<Lang, DripLocale> = { en, es, fr };

/** Business campaign locales, consumed by the campaign drip engine. */
export const businessLocales: Record<Lang, DripLocale> = MAP;
