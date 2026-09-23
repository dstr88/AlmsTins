// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import node from '@astrojs/node';
import sitemap from '@astrojs/sitemap';
import { sitemapFilter } from './src/lib/seo/sitemapFilter.mjs';

const host = process.env.HOST ?? '0.0.0.0';
const port = process.env.PORT ? Number(process.env.PORT) : 10000;

export default defineConfig({
	site: process.env.AUTH_URL ?? 'https://almstins.com',
	integrations: [
		react(),
		sitemap({
			// Only include public, indexable pages (see src/lib/seo/sitemapFilter.mjs)
			filter: sitemapFilter,
		}),
	],
	output: 'server',
	server: {
		host,
		port,
	},
	adapter: node({
		mode: 'standalone',
	}),
	security: {
		// Render proxies requests through localhost:10000 internally, so
		// Astro's origin check compares "https://almstins.com" (Origin header)
		// against "http://localhost:10000" (url.origin) and incorrectly rejects
		// all POST form submissions. @auth/core handles its own CSRF for auth routes.
		checkOrigin: false,
	},
	vite: {
		ssr: {
			// geoip-lite reads its MaxMind data files from disk at runtime; keep it
			// external so the bundler doesn't rewrite/break those file paths.
			external: ['geoip-lite'],
		},
	},
});
