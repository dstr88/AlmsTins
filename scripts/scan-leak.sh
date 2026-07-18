#!/usr/bin/env bash
#
# scan-leak.sh — block private names/secrets from reaching a remote.
#
# Patterns live in the gitignored ".scan-patterns" (real names never get committed).
#
# Two line formats in .scan-patterns:
#   1) A plain name on its own line            →  matched LITERALLY (case-insensitive).
#      Its own text is its canary, so it is always self-verifying. Easiest: one name per line.
#   2) <regex><TAB><canary>                     →  advanced. The regex is matched as ERE, and
#      the CANARY (a synthetic string the regex MUST match) proves the regex works. A regex
#      that fails its canary aborts the scan (fail-closed) — the "every pattern needs a canary" rule.
#
# Modes:
#   scan-leak.sh --all       scan every tracked line (one-time / initial push)
#   scan-leak.sh --staged    scan the staged diff (added lines only)
#   scan-leak.sh             pre-push: read git's "<lref> <lsha> <rref> <rsha>" on stdin,
#                            scan only the added lines being pushed (full tree for a new ref)
#
# Output redacts the matched text — reports file:line only, never the leaked value.
# Exit 0 = clean, exit 1 = blocked / misconfigured (fail-closed).

set -uo pipefail   # no -e: grep returns 1 on "no match", which is normal here.

ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || { echo "leak-scan: not a git repo." >&2; exit 1; }
PATTERNS_FILE="$ROOT/.scan-patterns"
NOISE=(':!package-lock.json' ':!pnpm-lock.yaml' ':!yarn.lock' ':!*.min.js' ':!*.min.css' ':!dist' ':!.astro')

fail() { echo "leak-scan: $*" >&2; exit 1; }

[[ -f "$PATTERNS_FILE" ]] || fail "no .scan-patterns file — refusing to pass (fail-closed). Create $PATTERNS_FILE (gitignored)."

# ── Load patterns. TAB → (regex, canary, mode E). No TAB → (literal name, self-canary, mode F).
pats=(); canaries=(); modes=()
while IFS= read -r raw || [[ -n "${raw:-}" ]]; do
  line="${raw%$'\r'}"                                  # tolerate CRLF
  [[ -z "${line//[[:space:]]/}" ]] && continue
  [[ "${line:0:1}" == "#" ]] && continue
  if [[ "$line" == *$'\t'* ]]; then
    pats+=("${line%%$'\t'*}"); canaries+=("${line#*$'\t'}"); modes+=("E")
  else
    pats+=("$line"); canaries+=("$line"); modes+=("F")   # plain name: literal, self-canary
  fi
done < "$PATTERNS_FILE"

[[ ${#pats[@]} -gt 0 ]] || fail ".scan-patterns has no active patterns — refusing to pass (fail-closed)."

# ── Canary self-test: each pattern must catch its own canary, or the scan is broken.
for i in "${!pats[@]}"; do
  c="${canaries[$i]}"
  [[ -n "$c" ]] || fail "pattern #$((i+1)) has no canary."
  if ! printf '%s' "$c" | grep -qi"${modes[$i]}" -- "${pats[$i]}" 2>/dev/null; then
    fail "pattern #$((i+1)) does not match its canary — it is broken. Aborting (fail-closed)."
  fi
done

# ── Collect the text to scan into $tmp (lines shaped as "path:...:content").
tmp="$(mktemp)"; trap 'rm -f "$tmp"' EXIT
mode="${1:-prepush}"
Z="0000000000000000000000000000000000000000"

added_lines() { # $1 = git diff range → "path: <added line>"
  git diff --unified=0 "$1" -- . "${NOISE[@]}" 2>/dev/null | awk '
    /^\+\+\+ /{ f=$2; sub(/^b\//,"",f); next }
    /^\+/ && !/^\+\+\+/ { print f": "substr($0,2) }'
}

case "$mode" in
  --all)     git grep -nI "" -- . "${NOISE[@]}" 2>/dev/null > "$tmp" ;;
  --staged)  git diff --cached --unified=0 -- . "${NOISE[@]}" 2>/dev/null | awk '
               /^\+\+\+ /{ f=$2; sub(/^b\//,"",f); next }
               /^\+/ && !/^\+\+\+/ { print f": "substr($0,2) }' > "$tmp" ;;
  *)         while read -r lref lsha rref rsha; do
               [[ -z "${lsha:-}" || "$lsha" == "$Z" ]] && continue
               if [[ "${rsha:-$Z}" == "$Z" ]]; then
                 git grep -nI "" "$lsha" -- . "${NOISE[@]}" 2>/dev/null >> "$tmp"
               else
                 added_lines "$rsha..$lsha" >> "$tmp"
               fi
             done ;;
esac

[[ -s "$tmp" ]] || { echo "leak-scan: clean (nothing to scan; ${#pats[@]} patterns, canaries verified)."; exit 0; }

# ── Scan. Report file:line, redact the match.
hits=0
for i in "${!pats[@]}"; do
  while IFS= read -r ln; do
    [[ -z "$ln" ]] && continue
    echo "  ✗ pattern #$((i+1)) — ${ln%%:*} [match redacted]" >&2
    hits=$((hits+1))
  done < <(grep -i"${modes[$i]}" -- "${pats[$i]}" "$tmp" 2>/dev/null | head -25)
done

if [[ $hits -gt 0 ]]; then
  echo "leak-scan: BLOCKED — $hits match(es) against private patterns. Nothing pushed." >&2
  echo "           Remove the content, or tighten the pattern if it is a false positive." >&2
  exit 1
fi
echo "leak-scan: clean (${#pats[@]} patterns, canaries verified)."
exit 0
