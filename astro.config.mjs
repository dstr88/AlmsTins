// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import node from '@astrojs/node';

export default defineConfig({
  output: 'server',

  adapter: node({
    mode: 'standalone',   // Required for Render
  }),

  integrations: [react()],

  server: {
    host: true,          // Allows Render to bind properly
    port: 10000          // Optional but good for clarity
  }
});