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
#                            scan only the added lines being pushed (the full tree for a new
#                            ref, or when this clone does not have the remote sha),
#                            the messages of the commits being pushed (rsha..lsha; otherwise
#                            the commits no remote-tracking ref already has), AND, for an
#                            annotated tag, the tag's own name, tagger and message
#
# Output redacts the matched text — reports file:line only, never the leaked value.
# A commit-message hit reports "commit <sha> message", a tag hit "tag <sha> message",
# never the message text.
# Exit 0 = clean, exit 1 = blocked / misconfigured / git error (fail-closed).

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

# Both helpers return non-zero on a git error (say, a sha this clone does not have), so the
# caller can fail closed instead of scanning nothing and calling it clean.
added_lines() { # args = git diff args (a range, or --cached) → "path: <added line>"
  # pipefail (set above) makes a failed git diff fail the whole pipeline.
  git diff --unified=0 "$@" -- . "${NOISE[@]}" </dev/null 2>/dev/null | awk '
    /^\+\+\+ /{ f=$2; sub(/^b\//,"",f); next }
    /^\+/ && !/^\+\+\+/ { print f": "substr($0,2) }'
}

tree_lines() { # $1 = optional rev (default: the work tree) → "path:line:content" per text line
  local st
  # git grep prefixes each line with "<rev>:"; drop it so a hit reports the file.
  git grep -nI "" "$@" -- . "${NOISE[@]}" </dev/null 2>/dev/null \
    | awk -v p="${1:-}:" 'p != ":" && index($0, p) == 1 { $0 = substr($0, length(p) + 1) } { print }'
  st=("${PIPESTATUS[@]}")
  [[ ${st[0]} -le 1 && ${st[1]} -eq 0 ]]   # git grep: 1 = no text lines (fine), 2+ = git error
}

# Commit messages get pushed too, and the diff scan never sees them, so a private name in
# a message used to slip through. Each message line becomes
# "commit <sha12> message: <text>", which makes a hit report the commit and not the text.
# Fails (returns 1) if the commits cannot be listed or read, so the caller can fail closed.
commit_messages() { # args = git rev-list args
  local list c
  list="$(git rev-list "$@" </dev/null 2>/dev/null)" || return 1
  while IFS= read -r c; do
    [[ -n "$c" ]] || continue
    git show -s --format=%B "$c" </dev/null 2>/dev/null | sed "s/^/commit ${c:0:12} message: /" || return 1
  done <<< "$list"
}

# An annotated tag carries its own name, tagger and message, which rev-list never shows
# (it peels the tag to its commit). Each of those lines becomes
# "tag <sha12> message: <text>". The object and type headers (a hash and a type name) and
# the tagger timestamp are generated, so they are left out. A tag of a tag is peeled one
# level at a time so every tag object in the chain is scanned. Prints nothing for a
# non-tag object. Fails (returns 1) if an object cannot be read.
tag_messages() { # $1 = object being pushed
  local obj="$1" type body
  type="$(git cat-file -t "$obj" </dev/null 2>/dev/null)" || return 1
  while [[ "$type" == "tag" ]]; do
    body="$(git cat-file tag "$obj" </dev/null 2>/dev/null)" || return 1
    printf '%s\n' "$body" | awk -v p="tag ${obj:0:12} message: " '
      hdr == 0 && $0 == ""     { hdr = 1; next }
      hdr == 0 && /^tag /      { print p $0; next }
      hdr == 0 && /^tagger /   { t = $0; sub(/ [0-9]+ [-+][0-9]+$/, "", t); print p t; next }
      hdr == 0                 { next }
      { print p $0 }' || return 1
    obj="$(printf '%s\n' "$body" | sed -n 's/^object //p' | head -n 1)"
    [[ -n "$obj" ]] || return 1
    type="$(git cat-file -t "$obj" </dev/null 2>/dev/null)" || return 1
  done
}

# Message canary: write every pattern's canary into the message of a throwaway commit and
# of a throwaway annotated tag of it, run them through commit_messages and tag_messages, and
# require each pattern to catch it in both, the same way each pattern must catch its own
# canary above. Both objects live in a temp object directory that is deleted afterward;
# nothing is written to the repo.
verify_message_canaries() {
  local objdir ctmp ttmp csha tsha msg="" i rc=0
  objdir="$(mktemp -d)" || return 1
  ctmp="$(mktemp)" || { rm -rf "$objdir"; return 1; }
  ttmp="$(mktemp)" || { rm -rf "$objdir" "$ctmp"; return 1; }
  for i in "${!canaries[@]}"; do msg+="${canaries[$i]}"$'\n'; done
  csha="$(GIT_OBJECT_DIRECTORY="$objdir" \
          GIT_AUTHOR_NAME=leak-scan GIT_AUTHOR_EMAIL=canary@leak-scan.invalid \
          GIT_COMMITTER_NAME=leak-scan GIT_COMMITTER_EMAIL=canary@leak-scan.invalid \
          git commit-tree "$(git hash-object -t tree /dev/null)" -m "$msg" </dev/null 2>/dev/null)" || rc=1
  [[ -n "$csha" ]] || rc=1
  if [[ $rc -eq 0 ]]; then
    tsha="$(printf 'object %s\ntype commit\ntag leak-scan-canary\ntagger leak-scan <canary@leak-scan.invalid> 0 +0000\n\n%s' \
              "$csha" "$msg" | GIT_OBJECT_DIRECTORY="$objdir" git mktag 2>/dev/null)" || rc=1
    [[ -n "$tsha" ]] || rc=1
  fi
  if [[ $rc -eq 0 ]]; then
    ( export GIT_OBJECT_DIRECTORY="$objdir"; commit_messages "$csha" ) > "$ctmp" || rc=1
    ( export GIT_OBJECT_DIRECTORY="$objdir"; tag_messages "$tsha" ) > "$ttmp" || rc=1
  fi
  if [[ $rc -eq 0 ]]; then
    for i in "${!pats[@]}"; do
      if ! grep -qi"${modes[$i]}" -- "${pats[$i]}" "$ctmp" 2>/dev/null; then
        echo "leak-scan: pattern #$((i+1)) is not caught in a commit message." >&2
        rc=1
      fi
      if ! grep -qi"${modes[$i]}" -- "${pats[$i]}" "$ttmp" 2>/dev/null; then
        echo "leak-scan: pattern #$((i+1)) is not caught in a tag message." >&2
        rc=1
      fi
    done
  fi
  rm -rf "$objdir" "$ctmp" "$ttmp"
  return $rc
}

case "$mode" in
  --all)     tree_lines > "$tmp" \
               || fail "could not list the tracked files. Aborting (fail-closed)." ;;
  --staged)  added_lines --cached > "$tmp" \
               || fail "could not read the staged diff. Aborting (fail-closed)." ;;
  *)         verify_message_canaries \
               || fail "message scan (commits and tags) failed its canary self-test. Aborting (fail-closed)."
             while read -r lref lsha rref rsha; do
               [[ -z "${lsha:-}" || "$lsha" == "$Z" ]] && continue
               # Only diff and walk from the remote sha when this clone has it. A new ref, or
               # a remote sha it does not have (say, the remote branch moved and was not
               # fetched before a force push), falls back to the full tree and to every
               # commit that no remote-tracking ref already contains.
               known_remote=0
               if [[ "${rsha:-$Z}" != "$Z" ]] && git cat-file -e "${rsha}^{commit}" </dev/null 2>/dev/null; then
                 known_remote=1
               fi
               if [[ $known_remote -eq 1 ]]; then
                 added_lines "$rsha..$lsha" >> "$tmp"
               else
                 tree_lines "$lsha" >> "$tmp"
               fi || fail "could not read the changes for ${lref:-?}. Aborting (fail-closed)."
               if [[ $known_remote -eq 1 ]]; then
                 commit_messages "$rsha..$lsha" >> "$tmp"
               else
                 commit_messages "$lsha" --not --remotes >> "$tmp"
               fi || fail "could not read the commit messages for ${lref:-?}. Aborting (fail-closed)."
               tag_messages "$lsha" >> "$tmp" \
                 || fail "could not read the tag message for ${lref:-?}. Aborting (fail-closed)."
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
