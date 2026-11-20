/**
 * Free-mail domains: mailbox providers anyone can open an address at, and internet providers'
 * own mailboxes. An address at one of these says nothing about a company.
 *
 * Used by the owner's admin page for the "Company email" evidence tag
 * (src/lib/adminNewAccounts.ts). It is evidence, not a verdict: a domain missing from this list
 * reads as a company's, so a small or regional free-mail provider can slip through. Add a domain
 * here when one does.
 *
 * Data only, lowercase, one entry per domain.
 */
export const FREE_MAIL_DOMAINS: ReadonlySet<string> = new Set([
	// Google
	'gmail.com', 'googlemail.com',
	// Microsoft
	'outlook.com', 'outlook.fr', 'outlook.es', 'outlook.de', 'outlook.it', 'outlook.co.uk', 'outlook.com.br',
	'hotmail.com', 'hotmail.fr', 'hotmail.es', 'hotmail.de', 'hotmail.it', 'hotmail.co.uk', 'hotmail.com.br',
	'live.com', 'live.fr', 'live.co.uk', 'live.de', 'live.it', 'live.com.mx', 'msn.com', 'passport.com',
	// Yahoo and AOL
	'yahoo.com', 'yahoo.fr', 'yahoo.es', 'yahoo.de', 'yahoo.it', 'yahoo.ca', 'yahoo.co.uk', 'yahoo.co.in',
	'yahoo.co.jp', 'yahoo.com.br', 'yahoo.com.mx', 'yahoo.com.ar', 'yahoo.com.au', 'ymail.com', 'rocketmail.com',
	'aol.com', 'aim.com',
	// Apple
	'icloud.com', 'me.com', 'mac.com', 'privaterelay.appleid.com',
	// Privacy-focused providers
	'proton.me', 'protonmail.com', 'protonmail.ch', 'pm.me', 'tutanota.com', 'tutanota.de', 'tutamail.com',
	'tuta.io', 'tuta.com', 'keemail.me', 'mailbox.org', 'posteo.de', 'posteo.net', 'hushmail.com',
	'startmail.com', 'duck.com', 'simplelogin.com', 'skiff.com',
	// Other worldwide providers
	'gmx.com', 'gmx.net', 'gmx.de', 'gmx.fr', 'gmx.es', 'gmx.at', 'gmx.ch', 'gmx.us', 'mail.com', 'email.com',
	'zoho.com', 'zohomail.com', 'fastmail.com', 'fastmail.fm', 'hey.com', 'inbox.com', 'lycos.com',
	'yandex.com', 'yandex.ru', 'ya.ru', 'mail.ru', 'inbox.ru', 'list.ru', 'bk.ru', 'rambler.ru',
	'qq.com', 'foxmail.com', '163.com', '126.com', 'yeah.net', 'sina.com', 'sina.cn', 'sohu.com', 'aliyun.com',
	'naver.com', 'daum.net', 'hanmail.net', 'kakao.com', 'rediffmail.com',
	// Europe
	'web.de', 't-online.de', 'freenet.de', 'arcor.de', 'orange.fr', 'wanadoo.fr', 'free.fr', 'laposte.net',
	'sfr.fr', 'neuf.fr', 'bbox.fr', 'libero.it', 'virgilio.it', 'tiscali.it', 'alice.it', 'tin.it',
	'telefonica.net', 'terra.es', 'sapo.pt', 'seznam.cz', 'centrum.cz', 'wp.pl', 'o2.pl', 'interia.pl',
	'onet.pl', 'op.pl', 'ukr.net', 'abv.bg', 'bluewin.ch', 'btinternet.com', 'sky.com', 'talktalk.net',
	'virginmedia.com', 'ntlworld.com', 'blueyonder.co.uk',
	// The Americas and Oceania
	'comcast.net', 'verizon.net', 'att.net', 'sbcglobal.net', 'bellsouth.net', 'cox.net', 'charter.net',
	'earthlink.net', 'juno.com', 'netzero.net', 'optonline.net', 'frontier.com', 'windstream.net',
	'rogers.com', 'shaw.ca', 'sympatico.ca', 'telus.net', 'videotron.ca',
	'uol.com.br', 'bol.com.br', 'terra.com.br', 'ig.com.br', 'globo.com', 'prodigy.net.mx',
	'bigpond.com', 'bigpond.net.au', 'optusnet.com.au', 'xtra.co.nz',
	// A provider's stand-in address, not a mailbox a company runs
	'users.noreply.github.com',
]);

/** The lowercased domain of an email address, or null when it has none. */
export function mailDomain(email: string | null | undefined): string | null {
	const text = String(email ?? '').trim().toLowerCase();
	const at = text.lastIndexOf('@');
	if (at < 1) return null;
	const domain = text.slice(at + 1);
	return domain.includes('.') ? domain : null;
}

/** True when the address has a domain and that domain is not a free-mail one. */
export function isCompanyEmail(email: string | null | undefined): boolean {
	const domain = mailDomain(email);
	return domain !== null && !FREE_MAIL_DOMAINS.has(domain);
}
