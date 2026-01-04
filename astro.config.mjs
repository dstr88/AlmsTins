// astro.config.mjs
import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel';   // ✅ modern import (not .../serverless)

const remoteUrl = process.env.ASTRO_DB_REMOTE_URL;
const remoteToken = process.env.ASTRO_DB_APP_TOKEN;

export default defineConfig({
  output: 'server',          // SSR output
  adapter: vercel(),         // Vercel adapter
  integrations: [
  ],
});
