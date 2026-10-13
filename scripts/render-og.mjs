#!/usr/bin/env node
/**
 * Renders the receivables link preview image: scripts/og/receivables-og.svg to
 * public/og-receivables.png (1200x630), the og:image and twitter:image of the /receivables landing.
 *
 *   node scripts/render-og.mjs
 *
 * Uses sharp, which Astro already installs (no new dependency). The SVG names its fonts
 * (Helvetica Neue, then Helvetica, then Arial), so the PNG comes out the same on the same machine
 * but not byte for byte across operating systems: re-render on a Mac, look at it, and commit both
 * files together. tests/receivables/ogImage.test.ts checks the PNG is 1200x630.
 */
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';

const SVG = fileURLToPath(new URL('./og/receivables-og.svg', import.meta.url));
const OUT = fileURLToPath(new URL('../public/og-receivables.png', import.meta.url));

const info = await sharp(SVG)
  .resize(1200, 630)
  .png({ compressionLevel: 9, palette: true })
  .toFile(OUT);
console.log(`[render-og] ${OUT}: ${info.width}x${info.height}, ${info.size} bytes`);
