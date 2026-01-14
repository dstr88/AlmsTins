// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import node from '@astrojs/node';
import auth from '@auth/astro';

export default defineConfig({
	integrations: [react(), auth()],
	output: 'server',
	adapter: node({
		mode: 'standalone',
		host: process.env.HOST ?? '0.0.0.0',
		port: process.env.PORT ? Number(process.env.PORT) : 10000,
	}),
});
