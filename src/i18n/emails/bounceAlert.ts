// Bounce-alert email (cron/detector) — EN · ES · FR.
//
// Fired when a P2P/crypto transfer OUT is immediately returned to the sender
// (a "bounce"): the same asset+amount comes back within a few seconds, meaning
// the recipient never received it. This alert tells the tenant their crypto did
// NOT send and the funds are back in their account.
//
// Email-i18n pattern (mirrors priceAlert.ts): the locale exposes render(args) ->
// { subject, text }; the sender resolves the recipient's stored language
// (auth_users.lang via getUserLang) and calls render(). Bodies use template
// literals (backticks), so apostrophes are safe. $ amounts stay formatted en-US
// by the caller.

import type { Lang } from '@/lib/i18n/locale';

export interface RenderedEmail {
  subject: string;
  text: string;
}

export interface BounceAlertEmailLocale {
  lang: Lang;
  render: (a: {
    symbol: string;       // asset ticker, e.g. BTC
    fmtAmount: string;    // crypto amount, e.g. 0.05488394
    fmtUsd: string;       // dollar value, e.g. $2,500.00
    recipient: string;    // where it was sent (phone / address / account)
    fmtDate: string;      // when the send happened (recipient-local or UTC)
    appBase: string;      // app base URL
  }) => RenderedEmail;
}

export const en: BounceAlertEmailLocale = {
  lang: 'en',
  render: ({ symbol, fmtAmount, fmtUsd, recipient, fmtDate, appBase }) => ({
    subject: `⚠️ Your ${symbol} transfer didn't go through — funds returned`,
    text: [
      `Heads up — a recent transfer from your account did not reach its recipient.`,
      ``,
      `We detected a "bounce": the crypto you sent came straight back to your`,
      `account within seconds, which means the recipient never received it. Your`,
      `funds are safe and back in your balance.`,
      ``,
      `  Asset     : ${symbol}`,
      `  Amount    : ${fmtAmount} (${fmtUsd})`,
      `  Sent to   : ${recipient}`,
      `  Date      : ${fmtDate}`,
      ``,
      `Why this happens: the destination usually can't receive this transfer —`,
      `for example, that phone number or account isn't set up to accept this`,
      `asset on the platform you sent from. Nothing was lost, but the transfer`,
      `did NOT complete.`,
      ``,
      `What to do:`,
      `  1. Double-check the recipient's details before trying again.`,
      `  2. Confirm they can actually receive this asset on that platform.`,
      `  3. Resend only once the destination is verified.`,
      ``,
      `Review this transfer in your ledger:`,
      `${appBase}/dashboard/research`,
      ``,
      `— Almstins`,
      ``,
      `This is an automated safety alert, sent because a transfer on your account bounced.`,
    ].join('\n'),
  }),
};

export const es: BounceAlertEmailLocale = {
  lang: 'es',
  render: ({ symbol, fmtAmount, fmtUsd, recipient, fmtDate, appBase }) => ({
    subject: `⚠️ Tu transferencia de ${symbol} no se completó — fondos devueltos`,
    text: [
      `Atención — una transferencia reciente de tu cuenta no llegó a su destinatario.`,
      ``,
      `Detectamos un "rebote": la cripto que enviaste volvió de inmediato a tu`,
      `cuenta en segundos, lo que significa que el destinatario nunca la recibió.`,
      `Tus fondos están seguros y de vuelta en tu saldo.`,
      ``,
      `  Activo      : ${symbol}`,
      `  Cantidad    : ${fmtAmount} (${fmtUsd})`,
      `  Enviado a   : ${recipient}`,
      `  Fecha       : ${fmtDate}`,
      ``,
      `Por qué ocurre: normalmente el destino no puede recibir esta transferencia —`,
      `por ejemplo, ese número o cuenta no está configurado para aceptar este activo`,
      `en la plataforma desde la que enviaste. No se perdió nada, pero la`,
      `transferencia NO se completó.`,
      ``,
      `Qué hacer:`,
      `  1. Verifica los datos del destinatario antes de intentarlo de nuevo.`,
      `  2. Confirma que realmente puede recibir este activo en esa plataforma.`,
      `  3. Reenvía solo cuando el destino esté verificado.`,
      ``,
      `Revisa esta transferencia en tu registro:`,
      `${appBase}/dashboard/research`,
      ``,
      `— Almstins`,
      ``,
      `Esta es una alerta de seguridad automática, enviada porque una transferencia en tu cuenta rebotó.`,
    ].join('\n'),
  }),
};

export const fr: BounceAlertEmailLocale = {
  lang: 'fr',
  render: ({ symbol, fmtAmount, fmtUsd, recipient, fmtDate, appBase }) => ({
    subject: `⚠️ Votre transfert de ${symbol} n'a pas abouti — fonds retournés`,
    text: [
      `Attention — un transfert récent de votre compte n'a pas atteint son destinataire.`,
      ``,
      `Nous avons détecté un « rebond » : la crypto que vous avez envoyée est`,
      `revenue immédiatement sur votre compte en quelques secondes, ce qui signifie`,
      `que le destinataire ne l'a jamais reçue. Vos fonds sont en sécurité et de`,
      `retour dans votre solde.`,
      ``,
      `  Actif       : ${symbol}`,
      `  Montant     : ${fmtAmount} (${fmtUsd})`,
      `  Envoyé à    : ${recipient}`,
      `  Date        : ${fmtDate}`,
      ``,
      `Pourquoi cela arrive : la destination ne peut généralement pas recevoir ce`,
      `transfert — par exemple, ce numéro ou ce compte n'est pas configuré pour`,
      `accepter cet actif sur la plateforme depuis laquelle vous avez envoyé. Rien`,
      `n'a été perdu, mais le transfert n'a PAS abouti.`,
      ``,
      `Que faire :`,
      `  1. Vérifiez les coordonnées du destinataire avant de réessayer.`,
      `  2. Confirmez qu'il peut réellement recevoir cet actif sur cette plateforme.`,
      `  3. Renvoyez uniquement une fois la destination vérifiée.`,
      ``,
      `Consultez ce transfert dans votre registre :`,
      `${appBase}/dashboard/research`,
      ``,
      `— Almstins`,
      ``,
      `Ceci est une alerte de sécurité automatique, envoyée car un transfert sur votre compte a rebondi.`,
    ].join('\n'),
  }),
};

const MAP: Record<Lang, BounceAlertEmailLocale> = { en, es, fr };

export function getBounceAlertEmail(lang: Lang): BounceAlertEmailLocale {
  return MAP[lang] ?? en;
}
