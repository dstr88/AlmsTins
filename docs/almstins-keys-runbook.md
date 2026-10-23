# Almstins key log: owner runbook

This runbook covers the public key log in `github.com/dstr88/almstins-keys`: its rules, how to
set it up, ordinary rotation, and what to do if a key is stolen. The format and rules are in
`scripts/keylog.mjs`, the tool is `scripts/key-log.mjs`, and the check a stranger runs is
`docs/verify-without-almstins.md`.

Only the owner does these steps, on their own machine. No session or service does them. Nothing
here reads or prints `ALMSTINS_SIGNING_KEY`.

## Where each key lives

| Key | Lives | Signs | Who can use it |
|---|---|---|---|
| Record signing key (online) | Render env `ALMSTINS_SIGNING_KEY` only | Records | The running service |
| Root key (offline) | A file on removable media, plus a paper backup. Never in Render, GitHub secrets or any repository. | Key-log entries only | The owner, by hand |

- The keys repository accepts pushes only from the owner's GitHub account, which uses a hardware
  second factor. It has branch protection on `main`, no deploy keys and no Render access.
- A stolen Render seed can sign records, but cannot add a key or undo a revocation.
- A stolen GitHub account can edit the file, but cannot forge a root signature.

## One-time setup

1. Create the root key, outside every repository:
   `node scripts/key-log.mjs new-root --out /Volumes/<usb>/almstins-root.seed`.
   Write the seed on paper too, and keep it apart from the drive.
2. Create the public repository `dstr88/almstins-keys`, and clone it next to this one.
3. Write the first entry: `node scripts/key-log.mjs init --log ../almstins-keys --root-seed <file>`
4. Add the current record key. Copy `key_id` and `public_key_hex` from the live
   `/.well-known/almstins-signing-key.json`, and set `--valid-from` to the day it first signed:
   `node scripts/key-log.mjs add-key --log ../almstins-keys --root-seed <file> --key-id <id> --public-key <hex> --valid-from <iso>`
5. Add any retired keys from `ALMSTINS_SIGNING_RETIRED_PUBKEYS` the same way, then run `retire`
   for each one.
6. Stamp every head file into Bitcoin with `ots stamp ../almstins-keys/heads/*.txt`. Commit
   `log.jsonl`, `heads/` and the `.ots` files, then push. About two hours later, run `ots upgrade`
   on the `.ots` files and commit again.
7. Copy into the keys repo:
   - `scripts/keylog.mjs`, `scripts/verify-record.mjs` and `scripts/key-log.mjs`
   - `docs/verify-without-almstins.md`, as its README
8. Post the root fingerprint that `new-root` printed somewhere Almstins doesn't host. LinkedIn
   works, and also the keys repo README. Then ask Software Heritage to archive the repo
   ("save code now") and capture the repo page in the Internet Archive.

After every later append, repeat steps 6 and 8, except posting the fingerprint again.

## Ordinary rotation

1. Generate the new seed with `node scripts/generate-signing-key.mjs`.
2. Append `add-key` for the new key, with `--valid-from` set to the planned switch time.
3. Put the old `key_id:public_key_hex` into `ALMSTINS_SIGNING_RETIRED_PUBKEYS`, swap
   `ALMSTINS_SIGNING_KEY` in Render, and run the Manual Deploy.
4. Append `retire` for the old key, with `--at` set to the switch time. Destroy the old seed.
5. Stamp, commit and push.

Old records keep verifying: the log keeps every key forever.

## If a signing key may have been stolen

1. Pick `compromised_since`, the **earliest** moment the seed could have been exposed. When in
   doubt, pick earlier. A record that can't be shown to predate this time stops counting, so
   later is the dangerous direction.
2. Append the revocation:
   `node scripts/key-log.mjs revoke --log ../almstins-keys --root-seed <file> --key-id <id> --compromised-since <iso> --reason "<short plain reason>"`
   Then stamp, commit and push right away. A revocation is final.
3. Rotate to a new key (see above), and say so publicly.
4. Records signed by the revoked key now verify only if a signature checkpoint dates them before
   `compromised_since`. Until signature checkpoints ship, every record that key signed shows as
   REJECTED, so turn them on before any theft.

## If the root key is lost or exposed

- **Lost but not exposed:** if you still hold any copy, write `rotate-root` to a new root, then
  post the new fingerprint. With no copy at all, the log can't grow. Start a new log under a new
  root, and say publicly why the fingerprint changed.
- **Exposed:** the thief could add keys. Start a new log under a new root, post the new
  fingerprint, and say publicly from what time the old root stopped being trusted.
