// Almstins Verify — monitoring/re-validation alert email — EN · ES · FR.
//
// Sent by the Phase-5 watchman cron (/api/cron/verify-monitor) to the destination
// owner's alert_email. Three kinds:
//   - revoked        : an address dropped out of a published list (entity revocation
//                      or a merchant address removed from the .well-known file).
//   - unreachable    : an entity's verified endpoint can't be reached — the public
//                      badge will lapse within the max-stale TTL (fail-safe, not stale).
//   - proof_changed  : a merchant's .well-known proof no longer validates — its
//                      addresses have lapsed and need a re-prove.
//   - destination_swap: the public page a merchant asked us to watch is no longer
//                      showing the destination they registered — a different value
//                      has replaced it (a likely QR/address swap on their own page).
//
// Same email-i18n pattern as healthAlert.ts: render(args) -> { subject, text };
// the cron resolves the recipient's stored language via auth_users.lang.

import type { Lang } from '@/lib/i18n/locale';

export interface RenderedEmail {
  subject: string;
  text: string;
}

export type VerifyAlertKind = 'revoked' | 'unreachable' | 'proof_changed' | 'destination_swap' | 'sanctions_flag';

export interface VerifyAlertEmailLocale {
  lang: Lang;
  render: (a: {
    kind: VerifyAlertKind;
    domain: string;       // the verified domain, or the destination label/page for 'destination_swap'
    items: string[];      // affected addresses / the conflicting value(s) found on the page
    appBase: string;      // e.g. "https://almstins.com"
  }) => RenderedEmail;
}

const bullets = (items: string[]): string[] => (items.length ? ['', ...items.map((a) => `  • ${a}`), ''] : ['']);

export const en: VerifyAlertEmailLocale = {
  lang: 'en',
  render: ({ kind, domain, items, appBase }) => {
    const manage = `${appBase}/dashboard/verify`;
    if (kind === 'revoked') {
      return {
        subject: `⚠️ A verified address was removed — ${domain}`,
        text: [
          `One or more addresses are no longer in the verified list published for ${domain},`,
          `so they have stopped showing as verified to the public.`,
          ...bullets(items),
          `If you removed them, no action is needed. If you didn't, check whether your`,
          `published list was changed without your knowledge.`,
          ``,
          `Manage your verified addresses:`,
          `${manage}`,
          ``,
          `— Almstins Verify`,
        ].join('\n'),
      };
    }
    if (kind === 'unreachable') {
      return {
        subject: `⚠️ We couldn't re-verify your addresses — ${domain}`,
        text: [
          `We couldn't reach the verified address endpoint for ${domain}.`,
          `Your published addresses will stop showing as verified within 24 hours if we`,
          `still can't reach it — we never show a stale "verified" we can't confirm.`,
          ``,
          `Check that your endpoint is reachable and the API key you issued us is still valid.`,
          ``,
          `Manage your verified endpoint:`,
          `${manage}`,
          ``,
          `— Almstins Verify`,
        ].join('\n'),
      };
    }
    if (kind === 'sanctions_flag') {
      return {
        subject: `🚨 Sanctions or blacklist flag on a verified address — ${domain}`,
        text: [
          `One or more addresses in your verified list for ${domain} have been flagged`,
          `by safety databases (OFAC sanctions, GoPlus global blacklist, or mixer activity):`,
          ...bullets(items),
          `You should remove any flagged address from your published list immediately.`,
          `An address that is sanctioned or blacklisted appearing in a verified list is a`,
          `serious compliance risk. This alert repeats every monitoring cycle until the`,
          `address is removed.`,
          ``,
          `Manage your verified addresses:`,
          `${manage}`,
          ``,
          `— Almstins Verify`,
        ].join('\n'),
      };
    }
    if (kind === 'destination_swap') {
      return {
        subject: `⚠️ Possible swap on your published page — ${domain}`,
        text: [
          `The page you asked us to watch for "${domain}" is no longer showing the`,
          `destination you registered. A different one has taken its place:`,
          ...bullets(items),
          `This is exactly what a QR or address swap looks like. If you changed it`,
          `yourself, no action is needed. If you didn't, your published page may have`,
          `been tampered with — check it now, before a customer pays the wrong place.`,
          ``,
          `Review your monitored destinations:`,
          `${manage}`,
          ``,
          `— Almstins Verify`,
        ].join('\n'),
      };
    }
    return {
      subject: `⚠️ Your address verification needs attention — ${domain}`,
      text: [
        `We could no longer validate the verification file published at ${domain},`,
        `so the addresses it vouched for have lapsed and no longer show as verified.`,
        ...bullets(items),
        `If you changed your published addresses, just re-verify in your dashboard.`,
        `If you didn't, your published proof may have been altered — worth a look.`,
        ``,
        `Re-verify:`,
        `${manage}`,
        ``,
        `— Almstins Verify`,
      ].join('\n'),
    };
  },
};

export const es: VerifyAlertEmailLocale = {
  lang: 'es',
  render: ({ kind, domain, items, appBase }) => {
    const manage = `${appBase}/dashboard/verify`;
    if (kind === 'revoked') {
      return {
        subject: `⚠️ Se eliminó una dirección verificada — ${domain}`,
        text: [
          `Una o más direcciones ya no están en la lista verificada publicada para ${domain},`,
          `por lo que han dejado de mostrarse como verificadas al público.`,
          ...bullets(items),
          `Si las eliminaste tú, no hace falta hacer nada. Si no fuiste tú, revisa si tu`,
          `lista publicada se cambió sin tu conocimiento.`,
          ``,
          `Gestiona tus direcciones verificadas:`,
          `${manage}`,
          ``,
          `— Almstins Verify`,
        ].join('\n'),
      };
    }
    if (kind === 'sanctions_flag') {
      return {
        subject: `🚨 Alerta de sanciones o lista negra en una dirección verificada — ${domain}`,
        text: [
          `Una o más direcciones en tu lista verificada de ${domain} han sido marcadas`,
          `por bases de datos de seguridad (sanciones OFAC, lista negra global de GoPlus, o actividad de mixer):`,
          ...bullets(items),
          `Debes eliminar cualquier dirección marcada de tu lista publicada de inmediato.`,
          `Una dirección sancionada o en lista negra que aparece en una lista verificada supone`,
          `un serio riesgo de cumplimiento normativo. Esta alerta se repite en cada ciclo de`,
          `monitoreo hasta que se elimine la dirección.`,
          ``,
          `Gestiona tus direcciones verificadas:`,
          `${manage}`,
          ``,
          `— Almstins Verify`,
        ].join('\n'),
      };
    }
    if (kind === 'unreachable') {
      return {
        subject: `⚠️ No pudimos volver a verificar tus direcciones — ${domain}`,
        text: [
          `No pudimos conectar con el endpoint de direcciones verificadas de ${domain}.`,
          `Tus direcciones publicadas dejarán de mostrarse como verificadas dentro de 24 horas`,
          `si seguimos sin poder conectar — nunca mostramos un "verificado" caducado que no podamos confirmar.`,
          ``,
          `Comprueba que tu endpoint sea accesible y que la clave de API que nos diste siga siendo válida.`,
          ``,
          `Gestiona tu endpoint verificado:`,
          `${manage}`,
          ``,
          `— Almstins Verify`,
        ].join('\n'),
      };
    }
    if (kind === 'destination_swap') {
      return {
        subject: `⚠️ Posible sustitución en tu página publicada — ${domain}`,
        text: [
          `La página que nos pediste vigilar para "${domain}" ya no muestra el destino`,
          `que registraste. Otro lo ha reemplazado:`,
          ...bullets(items),
          `Esto es exactamente cómo se ve una sustitución de QR o dirección. Si lo`,
          `cambiaste tú, no hace falta hacer nada. Si no fuiste tú, tu página publicada`,
          `podría haber sido manipulada — revísala ahora, antes de que un cliente pague al lugar equivocado.`,
          ``,
          `Revisa tus destinos monitoreados:`,
          `${manage}`,
          ``,
          `— Almstins Verify`,
        ].join('\n'),
      };
    }
    return {
      subject: `⚠️ Tu verificación de direcciones necesita atención — ${domain}`,
      text: [
        `Ya no pudimos validar el archivo de verificación publicado en ${domain},`,
        `por lo que las direcciones que respaldaba han caducado y ya no se muestran como verificadas.`,
        ...bullets(items),
        `Si cambiaste tus direcciones publicadas, simplemente vuelve a verificar en tu panel.`,
        `Si no fuiste tú, tu prueba publicada podría haber sido alterada — conviene revisarlo.`,
        ``,
        `Vuelve a verificar:`,
        `${manage}`,
        ``,
        `— Almstins Verify`,
      ].join('\n'),
    };
  },
};

export const fr: VerifyAlertEmailLocale = {
  lang: 'fr',
  render: ({ kind, domain, items, appBase }) => {
    const manage = `${appBase}/dashboard/verify`;
    if (kind === 'revoked') {
      return {
        subject: `⚠️ Une adresse vérifiée a été retirée — ${domain}`,
        text: [
          `Une ou plusieurs adresses ne figurent plus dans la liste vérifiée publiée pour ${domain},`,
          `elles ont donc cessé d'apparaître comme vérifiées auprès du public.`,
          ...bullets(items),
          `Si vous les avez retirées, aucune action n'est nécessaire. Sinon, vérifiez si votre`,
          `liste publiée a été modifiée à votre insu.`,
          ``,
          `Gérez vos adresses vérifiées :`,
          `${manage}`,
          ``,
          `— Almstins Verify`,
        ].join('\n'),
      };
    }
    if (kind === 'sanctions_flag') {
      return {
        subject: `🚨 Alerte sanctions ou liste noire sur une adresse vérifiée — ${domain}`,
        text: [
          `Une ou plusieurs adresses de votre liste vérifiée pour ${domain} ont été signalées`,
          `par des bases de données de sécurité (sanctions OFAC, liste noire mondiale GoPlus, ou activité de mixer) :`,
          ...bullets(items),
          `Vous devez retirer immédiatement toute adresse signalée de votre liste publiée.`,
          `Une adresse sanctionnée ou inscrite sur liste noire figurant dans une liste vérifiée`,
          `représente un risque de conformité sérieux. Cette alerte se répète à chaque cycle`,
          `de surveillance jusqu'à la suppression de l'adresse.`,
          ``,
          `Gérez vos adresses vérifiées :`,
          `${manage}`,
          ``,
          `— Almstins Verify`,
        ].join('\n'),
      };
    }
    if (kind === 'unreachable') {
      return {
        subject: `⚠️ Nous n'avons pas pu revérifier vos adresses — ${domain}`,
        text: [
          `Nous n'avons pas pu joindre le point d'accès des adresses vérifiées de ${domain}.`,
          `Vos adresses publiées cesseront d'apparaître comme vérifiées sous 24 heures si nous`,
          `ne parvenons toujours pas à le joindre — nous n'affichons jamais un « vérifié » périmé que nous ne pouvons confirmer.`,
          ``,
          `Vérifiez que votre point d'accès est joignable et que la clé API que vous nous avez fournie est toujours valide.`,
          ``,
          `Gérez votre point d'accès vérifié :`,
          `${manage}`,
          ``,
          `— Almstins Verify`,
        ].join('\n'),
      };
    }
    if (kind === 'destination_swap') {
      return {
        subject: `⚠️ Substitution possible sur votre page publiée — ${domain}`,
        text: [
          `La page que vous nous avez demandé de surveiller pour « ${domain} » n'affiche`,
          `plus la destination que vous avez enregistrée. Une autre l'a remplacée :`,
          ...bullets(items),
          `C'est exactement à cela que ressemble une substitution de QR ou d'adresse. Si`,
          `vous l'avez modifiée vous-même, aucune action n'est nécessaire. Sinon, votre`,
          `page publiée a peut-être été altérée — vérifiez-la maintenant, avant qu'un client ne paie au mauvais endroit.`,
          ``,
          `Vérifiez vos destinations surveillées :`,
          `${manage}`,
          ``,
          `— Almstins Verify`,
        ].join('\n'),
      };
    }
    return {
      subject: `⚠️ Votre vérification d'adresses nécessite votre attention — ${domain}`,
      text: [
        `Nous n'avons plus pu valider le fichier de vérification publié sur ${domain},`,
        `les adresses qu'il attestait ont donc expiré et n'apparaissent plus comme vérifiées.`,
        ...bullets(items),
        `Si vous avez modifié vos adresses publiées, il vous suffit de revérifier dans votre tableau de bord.`,
        `Sinon, votre preuve publiée a peut-être été altérée — cela mérite un coup d'œil.`,
        ``,
        `Revérifier :`,
        `${manage}`,
        ``,
        `— Almstins Verify`,
      ].join('\n'),
    };
  },
};

const MAP: Record<Lang, VerifyAlertEmailLocale> = { en, es, fr };

export function getVerifyAlert(lang: Lang): VerifyAlertEmailLocale {
  return MAP[lang] ?? en;
}
