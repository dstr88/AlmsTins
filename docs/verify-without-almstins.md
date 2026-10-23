# Checking an Almstins record without Almstins

This recipe is for anyone holding a record Almstins signed: a receivables proof file
(`*.proof.json`), a Year Summary proof bundle, or an operator report bundle. It works if
almstins.com is gone. It also tells you whether the record still counts if an Almstins signing
key was ever stolen.

Everything here uses open-source tools. Nothing contacts almstins.com.

## What you need

| Item | Where it comes from |
|---|---|
| The record file | Whoever gave it to you |
| The root key fingerprint | Posted publicly by Almstins, outside almstins.com. This is the one value you take on trust, so check it against more than one copy. |
| The key log | `github.com/dstr88/almstins-keys`, or any mirror (Software Heritage, the Internet Archive). It must verify against the fingerprint, so a copy from anywhere is fine. |
| The verifier | `scripts/verify-record.mjs` and `scripts/keylog.mjs`, from `github.com/dstr88/AlmsTins` or the copy in the keys repo. Both are short. Read them. |
| Node.js 20+ and three packages | `npm i @noble/ed25519 @noble/hashes canonicalize` |
| The OpenTimestamps client | `pip install opentimestamps-client` (gives you the `ots` command) |
| A Bitcoin block header source | Your own Bitcoin Core node, or block explorers run by different operators |

## Steps

**1. Get the key log and check it.**

```bash
git clone https://github.com/dstr88/almstins-keys
node scripts/key-log.mjs verify --log almstins-keys --root-fingerprint <posted fingerprint>
```

It must say the log verifies. It lists every key, the date it became valid, and whether it is
in force, retired, or revoked (with the time it stopped being trusted).

**2. Check that the log was not rewritten.** Every append's chain head is stamped into Bitcoin.

```bash
ots verify almstins-keys/heads/<last seq>.txt.ots
```

The head file must hold the head that step 1 printed. A rewritten log cannot carry an older
Bitcoin proof for its altered head.

**3. Check the record.**

```bash
node scripts/verify-record.mjs record.proof.json \
  --key-log almstins-keys --root-fingerprint <posted fingerprint> --write-ots record.ots
```

This recomputes the digest, which is SHA-256 of the RFC 8785 canonical JSON of the manifest. It
checks the Ed25519 signature under the key from the log, never the key the file carries. It also
saves the record's Bitcoin proof to `record.ots`.

**4. Date the record in Bitcoin.**

```bash
ots verify -d <digest> record.ots
```

Note the block time it prints. Without a local node, run `ots info record.ots`, then check that
block's Merkle root on two explorers run by different operators.

**5. Apply the key rules.** Run step 3 again with that time:

```bash
node scripts/verify-record.mjs record.proof.json \
  --key-log almstins-keys --root-fingerprint <posted fingerprint> --anchored-at <block time>
```

## How to read the result

| Result | Meaning |
|---|---|
| `VERIFIED` | Almstins signed this exact content with a key that was in force at a time Bitcoin proves. |
| `VERIFIED (undated)` | The signature is good and the key has never been revoked, but nothing dates the signature. Year Summary bundles always land here. If the key is ever revoked, an undated record stops counting. |
| `REJECTED` | The key was revoked or retired, and the record can't be shown to have been signed before that. |
| `UNKNOWN KEY` | The key is not in the log. |
| `TAMPERED` | The content, digest or signature does not match. |
| `UNVERIFIABLE` | There isn't enough to decide (for example, no key log was given). |

## Why a revoked key rejects even an anchored record

The record's Bitcoin proof covers its content, not its signature. Anyone can stamp any content
into Bitcoin. So someone who planned ahead could stamp a forged record early, steal the key
later, then sign it. The anchor would look old even though the signature is new.

The rule: after a revocation, only a Bitcoin proof that covers the **signature itself** counts.
Hourly signature checkpoints are planned to provide one. When a proof file carries a
`signature_checkpoint`, it can still be `VERIFIED` after a revocation, as long as the checkpoint's
block time is at least two hours before the revocation time (Bitcoin block times can be about
two hours off).

## What this does not prove

A valid record shows that Almstins signed this content and when it existed. It does not show
that the facts in it are true, that a debt is owed or paid, or who is behind any party it names.
