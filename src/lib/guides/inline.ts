/**
 * Inline markup for guide copy.
 *
 * Guides cite their sources inline, sometimes several links in one sentence, so each
 * paragraph is kept in the copy module exactly as written, in a small, strict subset of
 * Markdown. The page renders the tokens as elements (no set:html), and the JSON-LD uses the
 * plain text.
 *
 * Supported:
 *   [text](https://example.gov/page)       a link
 *   [text](<https://example.gov/a(b)>)     a link whose URL holds parentheses
 *   <https://example.gov/page>             a link that shows its own URL
 *   **text**                               strong
 *   *text*                                 emphasis
 *
 * Strong, emphasis and link text hold plain text only. Anything else that looks like markup
 * throws, so a typo fails the copy test (tests/seo/guides.test.ts) instead of reaching the page.
 */

export type InlineToken =
	| { type: 'text'; text: string }
	| { type: 'strong'; text: string }
	| { type: 'em'; text: string }
	| { type: 'link'; text: string; href: string };

const MARKUP = /[*[\]<>]/;

export function parseInline(md: string): InlineToken[] {
	const out: InlineToken[] = [];
	let text = '';
	let i = 0;

	const fail = (why: string): never => {
		throw new Error(`guide inline markup: ${why} at ${i} in "${md.slice(Math.max(0, i - 30), i + 50)}"`);
	};
	const flush = () => {
		if (text) out.push({ type: 'text', text });
		text = '';
	};
	const plain = (s: string, what: string) => {
		if (!s || MARKUP.test(s)) fail(`${what} must be non-empty plain text`);
		return s;
	};

	while (i < md.length) {
		const c = md[i];

		if (md.startsWith('**', i)) {
			const close = md.indexOf('**', i + 2);
			if (close < 0) fail('unclosed **');
			const inner = plain(md.slice(i + 2, close), 'strong text');
			flush();
			out.push({ type: 'strong', text: inner });
			i = close + 2;
			continue;
		}

		if (c === '*') {
			const close = md.indexOf('*', i + 1);
			if (close < 0) fail('unclosed *');
			const inner = plain(md.slice(i + 1, close), 'emphasis text');
			flush();
			out.push({ type: 'em', text: inner });
			i = close + 1;
			continue;
		}

		if (c === '[') {
			const mid = md.indexOf('](', i + 1);
			if (mid < 0) fail('link without (url)');
			const label = plain(md.slice(i + 1, mid), 'link text');
			let href: string;
			let after: number;
			if (md[mid + 2] === '<') {
				const close = md.indexOf('>)', mid + 3);
				if (close < 0) fail('unclosed (<url>)');
				href = md.slice(mid + 3, close);
				after = close + 2;
			} else {
				const close = md.indexOf(')', mid + 2);
				if (close < 0) fail('unclosed (url)');
				href = md.slice(mid + 2, close);
				after = close + 1;
			}
			if (!/^(https:\/\/|\/)\S+$/.test(href) || /[<>]/.test(href)) fail(`bad link url "${href}"`);
			flush();
			out.push({ type: 'link', text: label, href });
			i = after;
			continue;
		}

		if (c === '<') {
			const close = md.indexOf('>', i + 1);
			if (close < 0) fail('unclosed <url>');
			const href = md.slice(i + 1, close);
			if (!/^https:\/\/[^\s<>]+$/.test(href)) fail(`bad autolink "${href}"`);
			flush();
			out.push({ type: 'link', text: href, href });
			i = close + 1;
			continue;
		}

		if (c === ']' || c === '>') fail(`stray ${c}`);
		text += c;
		i += 1;
	}

	flush();
	return out;
}

/** The text a reader sees, with the markup and the URLs dropped. */
export function plainText(md: string): string {
	return parseInline(md)
		.map((t) => t.text)
		.join('');
}

/** Every link in the markup, in order. */
export function linksIn(md: string): { text: string; href: string }[] {
	return parseInline(md).flatMap((t) => (t.type === 'link' ? [{ text: t.text, href: t.href }] : []));
}
