// @ts-check
console.log('ASTRO CONFIG LOADED ✅ (should be @astrojs/node / standalone)');

import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import node from '@astrojs/node';

export default defineConfig({
  output: 'server',

  adapter: node({
    mode: 'standalone',
  }),

  integrations: [react()],

  server: {
    host: true,
    port: Number(process.env.PORT) || 10000, // Render usually sets PORT
  },
});