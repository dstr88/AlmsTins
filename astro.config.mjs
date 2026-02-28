// @ts-check
import { defineConfig } from 'astro/config';
<<<<<<< HEAD
import react from '@astrojs/react';
import node from '@astrojs/node';

export default defineConfig({
	integrations: [react()],
	output: 'server',
	adapter: node({
		mode: 'standalone',
		host: process.env.HOST ?? '0.0.0.0',
		port: process.env.PORT ? Number(process.env.PORT) : 10000,
	}),
});
=======
import node from '@astrojs/node';

export default defineConfig({
  // Enables full server-side rendering (SSR) + API routes (required for /api/check.json and Turso)
  // Use 'hybrid' instead if you want some pages to be static while others are dynamic/SSR
  output: 'server',

  // Node adapter with standalone mode — this generates dist/server/entry.mjs
  // which Passenger (cPanel) and Render expect for running a persistent Node server
  adapter: node({
    mode: 'standalone'
  }),

  // If you had any other config options before (e.g. integrations, vite, markdown, site, etc.),
  // add them here. Example placeholders:
  // site: 'https://titaniumhut.com',
  // integrations: [tailwind(), sitemap()],
  // vite: {
  //   ssr: {
  //     noExternal: ['@libsql/client'] // if needed for Turso in SSR
  //   }
  // },
  // markdown: { ... }
});
>>>>>>> 5eb5c46 (live)
