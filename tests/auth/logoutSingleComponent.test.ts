import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * One logout component. Four places used to sign people out in three different ways: the
 * dashboard menu posted a form to /api/logout, the Verify desks' menu and the sign-in page's
 * popup linked to Auth.js's own /api/auth/signout (a confirmation page this site cannot style
 * or measure), and the onboarding page linked to /api/logout with a plain GET. They now all
 * render src/components/LogoutButton.astro, which posts to /api/logout.
 *
 * These tests keep it that way: nothing else may name a logout endpoint, so a new "Log out"
 * button cannot quietly be a fifth way.
 *
 * The demo's "Exit demo" links (/api/demo/end) end a demo session, which is a different cookie
 * and not a sign-out, so they are not covered here on purpose.
 */
const ROOT = path.resolve(__dirname, '../..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');
const sourceFiles = execFileSync('git', ['ls-files', 'src'], { cwd: ROOT, encoding: 'utf8' })
	.split('\n')
	.filter(f => /\.(astro|tsx?|jsx?|mjs)$/.test(f));

/** The file's code and markup without comments, so prose that names a path does not count. */
const code = (text: string) =>
	text
		.replace(/<!--[\s\S]*?-->/g, '')
		.replace(/\/\*[\s\S]*?\*\//g, '')
		.split('\n')
		.filter(l => !l.trim().startsWith('//'))
		.join('\n');

describe('only the logout component names a logout endpoint', () => {
	// Each exception says why, so it is a decision and not an accident.
	const MAY_NAME_THE_ENDPOINTS: Record<string, string> = {
		'src/components/LogoutButton.astro': 'the one logout control',
		'src/pages/api/logout.ts': 'the endpoint it posts to',
		'src/middleware/auth.ts': 'lists /api/logout as reachable without a session',
		'src/components/AnalyticsPageContext.astro': 'counts sign-outs by listening for these paths; it never links to them',
	};

	it('no other page or script links, posts or redirects to /api/logout or /api/auth/signout', () => {
		const offenders = sourceFiles.filter(f => {
			if (f in MAY_NAME_THE_ENDPOINTS) return false;
			return /api\/logout|api\/auth\/signout/.test(code(read(f)));
		});
		expect(offenders).toEqual([]);
	});

	it('no client calls an Auth.js signOut() directly', () => {
		const offenders = sourceFiles.filter(f => /\bsignOut\s*\(/.test(code(read(f))));
		expect(offenders).toEqual([]);
	});
});

describe('every logout button is the component', () => {
	const CALL_SITES = [
		'src/layouts/Layout.astro',
		'src/components/verify/AccountMenu.astro',
		'src/components/LoginPageComponent.astro',
		'src/pages/onboarding/tenant-setup.astro',
	];

	it.each(CALL_SITES)('%s imports and renders <LogoutButton>', f => {
		const text = read(f);
		expect(text).toMatch(/import LogoutButton from ['"][^'"]*LogoutButton\.astro['"]/);
		expect(text).toMatch(/<LogoutButton\b/);
	});

	it('the Verify desks and the dashboard menu use the same classes they always did', () => {
		expect(read('src/layouts/Layout.astro')).toMatch(/<LogoutButton class="account-logout"/);
		expect(read('src/components/verify/AccountMenu.astro')).toMatch(/<LogoutButton class="account-logout"/);
	});

	it('the Verify desks sign out to their own sign-in page, and the landing back to itself', () => {
		const text = read('src/components/verify/AccountMenu.astro');
		expect(text).toMatch(/<LogoutButton [^>]*next=\{backTo\}/);
		expect(text).toMatch(/current === 'landing' \? '\/receivables' : `\/verify\/login\?next=\$\{currentHref\}`/);
	});

	it('the dashboard menu passes the page\'s logoutRedirect through', () => {
		expect(read('src/layouts/Layout.astro')).toMatch(/<LogoutButton [^>]*next=\{logoutRedirect\}/);
	});
});

describe('the component itself', () => {
	// Read inside each test, so a missing or renamed component fails these tests by name
	// instead of crashing the whole file and hiding the checks above.
	const component = () => read('src/components/LogoutButton.astro');
	const markup = () => component().split(/^---\s*$/m)[2] ?? '';

	it('posts to /api/logout', () => {
		expect(markup()).toMatch(/<form\b[^>]*\bmethod="post"/);
		expect(markup()).toMatch(/<form\b[^>]*\baction="\/api\/logout"/);
		expect(markup()).not.toMatch(/method="get"/i);
	});

	it('carries the destination as a hidden field, only when one is given', () => {
		expect(markup()).toMatch(/\{next && <input type="hidden" name="next" value=\{next\} \/>\}/);
	});

	it('is a submit button that takes the page\'s classes and label, with a default label', () => {
		expect(markup()).toMatch(/<button \{\.\.\.rest\} type="submit" class=\{className\}><slot>Log out<\/slot><\/button>/);
		expect(component()).toMatch(/class: className/);
	});

	it('spreads the rest props onto the button, which is how the page\'s style scope reaches it', () => {
		expect(component()).toMatch(/const \{ next, class: className, \.\.\.rest \} = Astro\.props/);
	});
});

/**
 * The first version of the component shipped with its buttons unstyled on the sign-in popup,
 * the Verify desks' menu and the onboarding page. A page's scoped <style> only matches elements
 * carrying that page's scope marker, and under Astro's default scoping (attribute) the marker is
 * a `data-astro-cid-…` PROP handed to the child component, not a class. The component has to put
 * it on the button, and it does so by spreading its rest props. Passing the marker as a prop is
 * Astro's compiler behavior, so it is pinned here against the real call sites, in each of
 * Astro's three scoping modes: if a future Astro stops passing it, this fails instead of the
 * buttons quietly losing their styles.
 *
 * The dashboard menu is the exception: its .account-logout rule lives in the global
 * src/layouts/Layout.css, so it needs no marker.
 */
describe('the page\'s styles reach the button', () => {
	const PAGES_WITH_SCOPED_STYLES = [
		'src/components/verify/AccountMenu.astro',
		'src/components/LoginPageComponent.astro',
		'src/pages/onboarding/tenant-setup.astro',
	];
	const STRATEGIES = ['attribute', 'where', 'class'] as const;

	/** The props the compiled page passes to <LogoutButton>, as written in the compiler's output. */
	async function propsPassedToLogoutButton(file: string, scopedStyleStrategy: (typeof STRATEGIES)[number]) {
		const { transform } = await import('@astrojs/compiler');
		const out = await transform(read(file), { filename: `/virtual/${file}`, scopedStyleStrategy });
		const call = out.code.match(/\$\$renderComponent\(\$\$result,'LogoutButton',LogoutButton,(\{[^}]*\})/);
		return call?.[1] ?? '';
	}

	describe.each(PAGES_WITH_SCOPED_STYLES)('%s', file => {
		it('hands its scope marker to the button as a data-astro-cid prop (Astro\'s default scoping)', async () => {
			expect(await propsPassedToLogoutButton(file, 'attribute')).toMatch(/"data-astro-cid-[a-z0-9]+":true/);
		});

		it.each(['where', 'class'] as const)('hands it as an extra class under the %s strategy', async strategy => {
			const props = await propsPassedToLogoutButton(file, strategy);
			expect(props).toMatch(/"class":"[^"]*\bastro-[a-z0-9]+"/);
		});
	});

	it('the dashboard menu\'s .account-logout rule is global, so it needs no marker', () => {
		expect(read('src/layouts/Layout.css')).toMatch(/^\.account-logout\s*\{/m);
		const layoutStyleBlocks = read('src/layouts/Layout.astro').match(/<style[\s\S]*?<\/style>/g) ?? [];
		expect(layoutStyleBlocks.filter(b => /\.account-logout/.test(b) && !/is:global/.test(b))).toEqual([]);
	});
});
