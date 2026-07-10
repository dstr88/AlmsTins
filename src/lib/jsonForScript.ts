/**
 * Serialize a value for safe embedding inside a `<script type="application/json">`
 * element via `set:html`.
 *
 * `JSON.stringify` alone is NOT safe here: if any string in the payload contains
 * `</script>` (e.g. a user-entered wallet label or an attacker-mintable on-chain
 * token symbol), the browser's HTML parser closes the script tag early and the
 * remainder is parsed as HTML — a stored-XSS breakout. Escaping `<` (plus `>` and
 * `&` for completeness) neutralizes the breakout. The output is still valid JSON,
 * so `JSON.parse(el.textContent)` reads the original value back identically.
 */
export function jsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
}
