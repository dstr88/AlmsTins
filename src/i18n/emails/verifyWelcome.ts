// Verify welcome drip: a 2-email series (EN · ES · FR), founder-voiced.
//
// Enrolled when an account that signed up through Almstins Verify has not registered a
// destination yet (onboardingDrip: enrollVerifyWelcome). Cadence day 0 / 3. It ends the moment
// the account registers a destination; the business series (business.ts) takes over from there.
// Shares dripTemplate (Telegram + reply footer, unsubscribe). Replies go to the founder's
// Almstins mailbox (campaignEmail: VERIFY_WELCOME_REPLY_TO), because the first email asks a
// question and says the answer comes to him.
//
// Rules for this copy (tests/verify/welcomeDripCopy.test.ts holds them):
//   - no em dash, in any language;
//   - Almstins warns and flags. It never says it stops, blocks or protects anything, and it calls
//     nothing safe;
//   - the steps use the Verify dashboard's own words (src/i18n/dashboard/verify.ts): the satoshi
//     test (a self-send), Claimed, Verified, the Free plan's 2 wallet addresses and 1 payment QR or
//     link;
//   - what a payer sees is the scanner's own wording (src/i18n/verifyScan.ts). The scanner page
//     renders in English today, so the Spanish and French emails describe the result and say so.

import type { Lang } from '@/lib/i18n/locale';
import type { DripLocale } from './dripTemplate';

export const en: DripLocale = {
  lang: 'en',
  brand: 'Almstins',
  signoff: 'Donnie',
  unsubscribe: 'Unsubscribe from these emails',
  contact: 'Reply any time, or message me on Telegram',
  emails: [
    {
      subject: 'Prove your first address on Almstins Verify',
      paragraphs: [
        'Thanks for signing up for Almstins Verify. There is one thing to do first: prove that the address you ask people to pay is yours.',
        'Add that address in your Verify dashboard, then claim it with the satoshi test (a self-send). From your own wallet app, you send a tiny, exact amount from the address back to itself. The coins stay in your wallet, and you pay only the normal network fee. No wallet connection and no signature.',
        'One question from me. What were you hoping to check? Reply to this email. It comes to me.',
      ],
      ctaLabel: 'Prove your first address',
      ctaPath: '/dashboard/verify',
    },
    {
      subject: 'Two ways to prove an address, and what a payer sees',
      paragraphs: [
        'There are two ways to prove an address on Almstins Verify. Each one earns a different mark.',
        'The first is the satoshi test (a self-send). From your own wallet app, you send a tiny, exact amount from the address back to itself. It costs only the normal network fee, with no wallet connection and no signature. The address then shows as Claimed.',
        'The second is a small file on your own website that lists the address. Almstins charges nothing for it, but you need a website you control. A claimed address then shows as Verified, with your domain beside it.',
        'Here is what a payer sees. Anyone can scan your QR or paste your address into the free scanner at almstins.com/verify/scan, with no account. An address nobody has proven reads "Not a verified destination". A claimed address reads "Claimed by an Almstins account", with no name. A verified address reads "Verified destination" and names the website that lists it.',
        'The Free plan holds 2 wallet addresses and 1 payment QR or link.',
      ],
      ctaLabel: 'Prove an address',
      ctaPath: '/dashboard/verify',
    },
  ],
};

export const es: DripLocale = {
  lang: 'es',
  brand: 'Almstins',
  signoff: 'Donnie',
  unsubscribe: 'Darse de baja de estos correos',
  contact: 'Responde cuando quieras, o escríbeme por Telegram',
  emails: [
    {
      subject: 'Demuestra tu primera dirección en Almstins Verify',
      paragraphs: [
        'Gracias por registrarte en Almstins Verify. Hay una cosa que hacer primero: demostrar que la dirección a la que pides que te paguen es tuya.',
        'Agrega esa dirección en tu panel de Verify y reclámala con la prueba del satoshi (un autoenvío). Desde tu propia app de billetera, envías una cantidad pequeña y exacta desde la dirección a sí misma. Las monedas se quedan en tu billetera y solo pagas la comisión normal de la red. Sin conectar la billetera y sin firmar nada.',
        'Una pregunta de mi parte. ¿Qué esperabas comprobar? Responde a este correo. Me llega a mí.',
      ],
      ctaLabel: 'Demostrar tu primera dirección',
      ctaPath: '/dashboard/verify',
    },
    {
      subject: 'Dos formas de demostrar una dirección, y lo que ve quien paga',
      paragraphs: [
        'Hay dos formas de demostrar una dirección en Almstins Verify. Cada una da una marca distinta.',
        'La primera es la prueba del satoshi (un autoenvío). Desde tu propia app de billetera, envías una cantidad pequeña y exacta desde la dirección a sí misma. Solo cuesta la comisión normal de la red, sin conectar la billetera y sin firmar nada. La dirección aparece entonces como «Control confirmado» (Claimed).',
        'La segunda es un archivo pequeño en tu propio sitio web que incluye la dirección. Almstins no cobra nada por ello, pero necesitas un sitio web que controles. Una dirección reclamada aparece entonces como «Verificado» (Verified), con tu dominio al lado.',
        'Esto es lo que ve quien paga. Cualquiera puede escanear tu QR o pegar tu dirección en el escáner gratuito de almstins.com/verify/scan, sin cuenta. Una dirección que nadie ha demostrado aparece como un destino no verificado. Una dirección reclamada aparece como reclamada por una cuenta de Almstins, sin nombre. Una dirección verificada aparece como un destino verificado, con el sitio web que la publica. Por ahora, el escáner muestra el resultado en inglés.',
        'El plan gratuito incluye 2 direcciones de billetera y 1 QR o enlace de pago.',
      ],
      ctaLabel: 'Demostrar una dirección',
      ctaPath: '/dashboard/verify',
    },
  ],
};

export const fr: DripLocale = {
  lang: 'fr',
  brand: 'Almstins',
  signoff: 'Donnie',
  unsubscribe: 'Se désabonner de ces e-mails',
  contact: 'Répondez quand vous voulez, ou écrivez-moi sur Telegram',
  emails: [
    {
      subject: 'Prouvez votre première adresse sur Almstins Verify',
      paragraphs: [
        'Merci de votre inscription à Almstins Verify. Il y a une chose à faire en premier : prouver que l’adresse à laquelle vous demandez d’être payé est bien la vôtre.',
        'Ajoutez cette adresse dans votre tableau de bord Verify, puis revendiquez-la avec le test du satoshi (un auto-envoi). Depuis votre propre application de portefeuille, vous envoyez un petit montant exact de l’adresse vers elle-même. Les fonds restent dans votre portefeuille et vous ne payez que les frais de réseau habituels. Sans connexion de portefeuille et sans signature.',
        'Une question de ma part. Que souhaitiez-vous vérifier ? Répondez à cet e-mail. Il m’arrive directement.',
      ],
      ctaLabel: 'Prouver votre première adresse',
      ctaPath: '/dashboard/verify',
    },
    {
      subject: 'Deux façons de prouver une adresse, et ce que voit un payeur',
      paragraphs: [
        'Il y a deux façons de prouver une adresse sur Almstins Verify. Chacune donne une mention différente.',
        'La première est le test du satoshi (un auto-envoi). Depuis votre propre application de portefeuille, vous envoyez un petit montant exact de l’adresse vers elle-même. Cela ne coûte que les frais de réseau habituels, sans connexion de portefeuille et sans signature. L’adresse apparaît alors comme « Contrôle confirmé » (Claimed).',
        'La seconde est un petit fichier sur votre propre site web qui liste l’adresse. Almstins ne facture rien pour cela, mais il vous faut un site web que vous contrôlez. Une adresse revendiquée apparaît alors comme « Vérifié » (Verified), avec votre domaine à côté.',
        'Voici ce que voit un payeur. N’importe qui peut scanner votre QR ou coller votre adresse dans le scanner gratuit sur almstins.com/verify/scan, sans compte. Une adresse que personne n’a prouvée apparaît comme une destination non vérifiée. Une adresse revendiquée apparaît comme revendiquée par un compte Almstins, sans nom. Une adresse vérifiée apparaît comme une destination vérifiée, avec le site web qui la publie. Pour l’instant, le scanner affiche le résultat en anglais.',
        'Le forfait gratuit comprend 2 adresses de portefeuille et 1 QR ou lien de paiement.',
      ],
      ctaLabel: 'Prouver une adresse',
      ctaPath: '/dashboard/verify',
    },
  ],
};

/** Verify welcome campaign locales, consumed by the campaign drip engine. */
export const verifyWelcomeLocales: Record<Lang, DripLocale> = { en, es, fr };
