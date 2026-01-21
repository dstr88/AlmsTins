// @ts-check
import { defineConfig } from 'astro/config';
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
