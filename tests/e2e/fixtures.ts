import { test as base, expect } from '@playwright/test';

/**
 * The Playwright `test` for every E2E file, with Google Analytics blocked.
 *
 * The public smoke tests run every 6 hours against the live site from GitHub's runners, and
 * each run used to land in GA as a handful of new "visitors" from data-center cities. The
 * pages already mark an automated browser as internal traffic (AnalyticsPageContext.astro),
 * but that only helps once GA4's Internal Traffic filter is active. Blocking the requests here
 * keeps the runs out of GA entirely. The inline tag still runs, so window.gtag and dataLayer
 * behave as they do for a visitor; only the network calls to Google are dropped.
 *
 * Import `test` and `expect` from this file, not from '@playwright/test'.
 */
const GA_HOSTS = /^https:\/\/([a-z0-9-]+\.)*(googletagmanager\.com|google-analytics\.com|analytics\.google\.com)\//;

export const test = base.extend<{ blockAnalytics: void }>({
	blockAnalytics: [
		async ({ context }, use) => {
			await context.route(GA_HOSTS, (route) => route.abort());
			await use();
		},
		{ auto: true },
	],
});

export { expect };
