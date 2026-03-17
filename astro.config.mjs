// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import node from '@astrojs/node';

const host = process.env.HOST ?? '0.0.0.0';
const port = process.env.PORT ? Number(process.env.PORT) : 10000;

export default defineConfig({
	site: process.env.AUTH_URL ?? 'https://almstins.com',
	integrations: [react()],
	output: 'server',
	server: {
		host,
		port,
	},
	adapter: node({
		mode: 'standalone',
	}),
});
