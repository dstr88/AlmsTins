/**
 * Copy for the "email me a download link" button on the history download and for the email it
 * sends. The email carries a link to the dashboard page, never the file itself: Google and other
 * mail providers block some archives, and a link also keeps the records out of the inbox.
 */
import type { Lang } from '@/lib/i18n/locale';

export interface DownloadLinkEmailStrings {
	btnLabel: string;
	btnBusy: string;
	btnSent: string;
	btnError: string;
	btnCooldown: (minutes: number) => string;
	mail: {
		subject: string;
		body: string;
		linkIntro: string;
		footer: string;
	};
}

const en: DownloadLinkEmailStrings = {
	btnLabel: '✉ Email me a download link',
	btnBusy: 'Sending…',
	btnSent: 'We sent the link to your account email. Open it, sign in, and download the file from that page.',
	btnError: 'The email did not send. Please try again.',
	btnCooldown: (minutes) => `A link was sent a moment ago. You can send another in about ${minutes} minute${minutes === 1 ? '' : 's'}.`,
	mail: {
		subject: 'Your Almstins download is ready',
		body: 'Your records are ready to download from Almstins. The file is not attached to this email: open the link below, sign in, and use the download button on that page.',
		linkIntro: 'Open your download page:',
		footer: 'If you did not ask for this, you can ignore this email.',
	},
};

const es: DownloadLinkEmailStrings = {
	btnLabel: '✉ Enviarme un enlace de descarga',
	btnBusy: 'Enviando…',
	btnSent: 'Enviamos el enlace al correo de tu cuenta. Ábrelo, inicia sesión y descarga el archivo desde esa página.',
	btnError: 'El correo no se envió. Inténtalo de nuevo.',
	btnCooldown: (minutes) => `Acabamos de enviar un enlace. Puedes pedir otro en unos ${minutes} minuto${minutes === 1 ? '' : 's'}.`,
	mail: {
		subject: 'Tu descarga de Almstins está lista',
		body: 'Tus registros están listos para descargar en Almstins. El archivo no va adjunto a este correo: abre el enlace de abajo, inicia sesión y usa el botón de descarga de esa página.',
		linkIntro: 'Abre tu página de descarga:',
		footer: 'Si no pediste esto, puedes ignorar este correo.',
	},
};

const fr: DownloadLinkEmailStrings = {
	btnLabel: '✉ M’envoyer un lien de téléchargement',
	btnBusy: 'Envoi…',
	btnSent: 'Nous avons envoyé le lien à l’adresse de votre compte. Ouvrez-le, connectez-vous et téléchargez le fichier depuis cette page.',
	btnError: 'L’e-mail n’a pas été envoyé. Veuillez réessayer.',
	btnCooldown: (minutes) => `Un lien vient d’être envoyé. Vous pourrez en demander un autre dans environ ${minutes} minute${minutes === 1 ? '' : 's'}.`,
	mail: {
		subject: 'Votre téléchargement Almstins est prêt',
		body: 'Vos registres sont prêts à être téléchargés depuis Almstins. Le fichier n’est pas joint à cet e-mail : ouvrez le lien ci-dessous, connectez-vous et utilisez le bouton de téléchargement de cette page.',
		linkIntro: 'Ouvrez votre page de téléchargement :',
		footer: 'Si vous n’avez pas demandé ceci, vous pouvez ignorer cet e-mail.',
	},
};

const LOCALES: Record<Lang, DownloadLinkEmailStrings> = { en, es, fr };

export function getDownloadLinkEmail(lang: Lang): DownloadLinkEmailStrings {
	return LOCALES[lang] ?? en;
}
