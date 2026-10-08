// PetroTins visibility switch. The one line to change to make PetroTins public again.
//
// false: PetroTins is owner-only. Every /petro-tins, /dashboard/petro-tins and
// /api/petro-tins path answers a plain 404 to anyone but the owner, it is left out of
// the sitemap, and its links render only for the owner (see src/lib/petroTinsAccess.ts).
// true: PetroTins is public, as it was before (public landing, docs, legal pages, demo).
//
// Owner sign-in while private: /login?next=%2Fdashboard%2Fpetro-tins (on tradifitins.com
// too). /petro-tins and a signed-out /dashboard/petro-tins are 404s, so they cannot sign
// anyone in. Signed in, the owner also gets a PetroTins link in the nav.
//
// A plain .mjs with no imports so astro.config.mjs (through src/lib/seo/sitemapFilter.mjs)
// can load it natively; TypeScript files import it through petroTinsAccess.ts.

/** @type {boolean} */
export const PETRO_TINS_PUBLIC = false;
