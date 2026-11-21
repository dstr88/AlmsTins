#!/usr/bin/env node
/**
 * Renders the link preview images (Open Graph / X cards), each 1200x630, from the SVGs in scripts/og/:
 *   receivables-og.svg -> public/og-receivables.png (the /receivables landing)
 *   agentics-og.svg    -> public/og-agentics.png    (the /agentics landing)
 *   verify-og.svg      -> public/og-verify.png      (/verify)
 *   verify-es-og.svg   -> public/og-verify-es.png   (/verify/es)
 *   verify-fr-og.svg   -> public/og-verify-fr.png   (/verify/fr)
 *
 *   node scripts/render-og.mjs
 *
 * Uses sharp, which Astro already installs (no new dependency). The SVGs name their fonts
 * (Helvetica Neue, then Helvetica, then Arial), so the PNGs come out the same on the same machine
 * but not byte for byte across operating systems: re-render on a Mac, look at them, and commit the
 * SVGs and PNGs together. The tests (tests/receivables/ogImage.test.ts, tests/og/linkCards.test.ts)
 * check every PNG is 1200x630 and small. The card each page uses is in src/lib/ogCards.ts.
 */
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';

const CARDS = [
  [new URL('./og/receivables-og.svg', import.meta.url), new URL('../public/og-receivables.png', import.meta.url)],
  [new URL('./og/agentics-og.svg', import.meta.url), new URL('../public/og-agentics.png', import.meta.url)],
  [new URL('./og/verify-og.svg', import.meta.url), new URL('../public/og-verify.png', import.meta.url)],
  [new URL('./og/verify-es-og.svg', import.meta.url), new URL('../public/og-verify-es.png', import.meta.url)],
  [new URL('./og/verify-fr-og.svg', import.meta.url), new URL('../public/og-verify-fr.png', import.meta.url)],
];

for (const [svgUrl, outUrl] of CARDS) {
  const SVG = fileURLToPath(svgUrl);
  const OUT = fileURLToPath(outUrl);
  const info = await sharp(SVG)
    .resize(1200, 630)
    .png({ compressionLevel: 9, palette: true })
    .toFile(OUT);
  console.log(`[render-og] ${OUT}: ${info.width}x${info.height}, ${info.size} bytes`);
}
