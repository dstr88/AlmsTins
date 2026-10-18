/**
 * The plain words for an error code the Vault's API answered with. One place, so every form on
 * the Agentics pages says the same thing, and a code this page does not know (or one that is not
 * a code at all) is the plain fallback rather than anything the server sent.
 */
import { copy } from './copy';

export function errorText(code: unknown): string {
  return typeof code === 'string' && Object.prototype.hasOwnProperty.call(copy.errors, code) ? copy.errors[code] : copy.errors.generic;
}
