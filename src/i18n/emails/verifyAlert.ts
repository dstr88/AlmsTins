// Almstins Verify — monitoring/re-validation alert email — EN · ES · FR.
//
// Sent by the Phase-5 watchman cron (/api/cron/verify-monitor) to the destination
// owner's alert_email. Three kinds:
//   - revoked        : an address dropped out of a published list (entity revocation
//                      or a merchant address removed from the .well-known file).
//   - unreachable    : an entity's verified endpoint can't be reached — the public
//                      badge will lapse within the max-stale TTL (fail-safe, not stale).
//   - proof_changed  : a merchant's .well-known proof no longer validates — its
//                      addresses no longer show as verified (file-proven ones lapse;
//                      self-send-proven ones drop back to claimed) until re-verified.
//   - destination_swap: the public page a merchant asked us to watch is no longer
//                      showing the destination they registered — a different value
//                      has replaced it (a likely QR/address swap on their own page).
//   - list_conflict  : to a platform (guard PR B, spec 3g): its pulled list has entries another
//                      account has proven; `items` are those addresses, used for the count only,
//                      and the dashboard shows which. Nothing names the other account.
//   - listed_by_platform: to a merchant (spec 3g): a platform's published list carries one of
//                      their proven destinations. No address, no platform, no amount in the
//                      email; `domain` and `items` are ignored. The dashboard marks the row.
//
// Same email-i18n pattern as healthAlert.ts: render(args) -> { subject, text };
// the cron resolves the recipient's stored language via auth_users.lang.

import type { Lang } from '@/lib/i18n/locale';

export interface RenderedEmail {
  subject: string;
  text: string;
}

export type VerifyAlertKind = 'revoked' | 'unreachable' | 'proof_changed' | 'destination_swap' | 'list_conflict' | 'listed_by_platform';

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
    if (kind === 'list_conflict') {
      const n = items.length;
      return {
        subject: `⚠️ Your published list has ${n} ${n === 1 ? 'entry' : 'entries'} another account has proven: ${domain}`,
        text: [
          `Your published list for ${domain} has ${n} ${n === 1 ? 'entry' : 'entries'} another Almstins account`,
          `has proven control of. ${n === 1 ? 'It is' : 'They are'} shown to no one until the conflict clears.`,
          ``,
          `Open your Verify dashboard to see which. If ${n === 1 ? 'the entry is' : 'they are'} yours, prove`,
          `${n === 1 ? 'it' : 'them'} from your account; if not, remove ${n === 1 ? 'it' : 'them'} from your list.`,
          ``,
          `Your lists:`,
          `${manage}`,
          ``,
          `— Almstins Verify`,
        ].join('\n'),
      };
    }
    if (kind === 'listed_by_platform') {
      return {
        subject: `A platform's published list carries one of your proven destinations`,
        text: [
          `A platform's published address list carries one of the destinations you have proven.`,
          `Your proof stands. Until the listing is withdrawn, that address answers as disputed to`,
          `anyone who checks it, and no party is named.`,
          ``,
          `Your dashboard marks the destination. If you also run that platform, prove the address`,
          `from the same account and the conflict clears.`,
          ``,
          `Your destinations:`,
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
        `so the addresses it vouched for no longer show as verified.`,
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
    if (kind === 'list_conflict') {
      const n = items.length;
      return {
        subject: `⚠️ Tu lista publicada tiene ${n} ${n === 1 ? 'entrada' : 'entradas'} que otra cuenta ha demostrado: ${domain}`,
        text: [
          `Tu lista publicada para ${domain} tiene ${n} ${n === 1 ? 'entrada' : 'entradas'} cuyo control otra cuenta`,
          `de Almstins ha demostrado. No se ${n === 1 ? 'muestra' : 'muestran'} a nadie hasta que el conflicto se resuelva.`,
          ``,
          `Abre tu panel de Verify para ver ${n === 1 ? 'cuál' : 'cuáles'}. Si ${n === 1 ? 'es tuya, demuéstrala' : 'son tuyas, demuéstralas'}`,
          `desde tu cuenta; si no, ${n === 1 ? 'quítala' : 'quítalas'} de tu lista.`,
          ``,
          `Tus listas:`,
          `${manage}`,
          ``,
          `— Almstins Verify`,
        ].join('\n'),
      };
    }
    if (kind === 'listed_by_platform') {
      return {
        subject: `La lista publicada de una plataforma incluye uno de tus destinos demostrados`,
        text: [
          `La lista de direcciones publicada de una plataforma incluye uno de los destinos que has demostrado.`,
          `Tu prueba se mantiene. Hasta que se retire la entrada, esa dirección responde como en disputa`,
          `a quien la compruebe, y no se nombra a ninguna de las partes.`,
          ``,
          `Tu panel marca el destino. Si esa plataforma también es tuya, demuestra la dirección desde la`,
          `misma cuenta y el conflicto se resuelve.`,
          ``,
          `Tus destinos:`,
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
        `por lo que las direcciones que respaldaba ya no se muestran como verificadas.`,
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
    if (kind === 'list_conflict') {
      const n = items.length;
      return {
        subject: `⚠️ Votre liste publiée contient ${n} ${n === 1 ? 'entrée' : 'entrées'} qu'un autre compte a prouvée${n === 1 ? '' : 's'} : ${domain}`,
        text: [
          `Votre liste publiée pour ${domain} contient ${n} ${n === 1 ? 'entrée' : 'entrées'} dont un autre compte Almstins`,
          `a prouvé le contrôle. ${n === 1 ? 'Elle n’est montrée' : 'Elles ne sont montrées'} à personne tant que le conflit n’est pas levé.`,
          ``,
          `Ouvrez votre tableau de bord Verify pour voir ${n === 1 ? 'laquelle' : 'lesquelles'}. Si ${n === 1 ? 'elle est à vous, prouvez-la' : 'elles sont à vous, prouvez-les'}`,
          `depuis votre compte ; sinon, ${n === 1 ? 'retirez-la' : 'retirez-les'} de votre liste.`,
          ``,
          `Vos listes :`,
          `${manage}`,
          ``,
          `— Almstins Verify`,
        ].join('\n'),
      };
    }
    if (kind === 'listed_by_platform') {
      return {
        subject: `La liste publiée d'une plateforme contient l'une de vos destinations prouvées`,
        text: [
          `La liste d’adresses publiée d’une plateforme contient l’une des destinations que vous avez prouvées.`,
          `Votre preuve reste valable. Tant que l’entrée n’est pas retirée, cette adresse répond comme`,
          `contestée à quiconque la vérifie, et aucune partie n’est nommée.`,
          ``,
          `Votre tableau de bord marque la destination. Si cette plateforme est aussi la vôtre, prouvez`,
          `l’adresse depuis le même compte et le conflit est levé.`,
          ``,
          `Vos destinations :`,
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
        `les adresses qu'il attestait n'apparaissent donc plus comme vérifiées.`,
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
