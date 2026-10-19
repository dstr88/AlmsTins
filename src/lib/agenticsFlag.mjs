// Agent Vault visibility switch. The one line to change to open the Agent Vault to every account.
//
// false: the Agent Vault is owner-only. Every page under /dashboard/agentics/ and every
// /api/agentics path answers a plain 404 to anyone but the owner (signed out, demo, another
// account), and the Vault page or endpoint never runs (see src/lib/agenticsAccess.ts). The exact
// path /dashboard/agentics is not the Vault: it is the free-signup door's welcome letter, open to
// every signed-in account whatever this says.
// true: any signed-in, non-demo account may use it. It is still never a signed-out surface: the
// Vault paths stay out of isPublicPath, so a signed-out request is refused like any other tenant
// path (401 for an API call, a sign-in redirect for a page).
//
// Not part of the Vault, so who may reach them is not affected by this switch: the public Agentics pages
// (/agentics, /agentics/docs and the sign-in /agentics/login), the door's welcome letter at
// /dashboard/agentics, and the pre-send destination check /api/verify/check (all live). What the door's
// pages SAY does follow it: the landing, the sign-in, the welcome letter and the docs' vault section read
// "opening soon" while this is false and describe an open vault once it is true.
//
// A plain .mjs with no imports so a build-time file (the sitemap filter, once the Vault has pages)
// can load it natively; TypeScript files import it through agenticsAccess.ts.

/** @type {boolean} */
export const AGENTICS_VAULT_PUBLIC = false;
