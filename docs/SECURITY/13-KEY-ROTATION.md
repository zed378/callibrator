# 13 — Key Rotation Runbook

> As-built 2026-09-24 (P6-10, S-08, S-26 — ADR-PENDING-data). Source files named in each section.
> **Rehearsed on PostgreSQL 16 against seeded data** (`backend/src/tests/services/keyRotation.s08.live.test.js`),
> **not against a copy of production.** Do that rehearsal before the first real rotation — a procedure that has
> never met real data is the P6-10 abuse case.

"Rotate the key" is only a response to a suspected compromise if it can be done calmly. Every secret below
can now be rotated without a flag day, and each rotation has the same three-step shape:

1. **Add** the new key as current, keep the old one as *previous* — everything still reads, everything new is
   written under the new key.
2. **Move** what is stored under the old key (only for keys that protect stored data).
3. **Remove** the previous key — only once step 2 reports nothing left under it.

**The rollback at every point before step 3 is: keep (or put back) the previous key.** Nothing is ever
unreadable while both keys are configured. After step 3 the old key is gone; if step 2 was not finished, the
rows it had not reached are unreadable until the old key is restored — which is why the old key is **backed up
until the rotation is signed off**, exactly like the current one.

A key ID in this system is a **fingerprint**: 16 hex characters of a domain-separated SHA-256 of the key
(`backend/src/utils/keyring.util.js`). It is the same on every replica and in every script, is safe to log,
and is never the key.

---

## `KMS_MASTER_KEY` — every tenant secret at rest

**Protects** (`backend/src/services/kms.service.js`): `tenant_settings` secret values (SSO/OIDC/Stripe/storage/AI
credentials…), `webhooks.secret`, and — since migration 0058 — `tenant_keys.private_key`, the e-signature
private keys.

**Format.** `v2:<keyId>:<encDEK>:<dekIv>:<dekTag>:<encData>:<dataIv>:<dataTag>` — AES-256-GCM, a fresh data key per
value, the tenant id as AAD. Envelopes written before P6-10 are `v1:` with no key id; they are read by trying each
key of the ring (GCM authentication picks the right one).

### Procedure

```bash
# 0. Before: know what you are rotating from.
cd backend && npm run keys:rotate -- --dry-run      # prints the current key id and what would move

# 1. Add. Generate the new key and deploy with BOTH:
openssl rand -hex 32                                  # the new KMS_MASTER_KEY
#   KMS_MASTER_KEY=<new>
#   KMS_MASTER_KEY_PREVIOUS=<old>                     # comma-separated if several
make deploy                                           # or: helm upgrade … / restart every replica
#   Every replica must run with the new ring before step 2 — a replica still on
#   the old key alone cannot read what step 2 writes.

# 2. Move. From a host checkout whose backend/.env carries the SAME three values
#    (KMS_MASTER_KEY, KMS_MASTER_KEY_PREVIOUS, and ENCRYPT_KEY while legacy signing keys exist):
cd backend && npm run keys:rotate -- --dry-run       # expect: re-wrapped N, failed 0
cd backend && npm run keys:rotate                     # resumable; exit 1 on any failure
cd backend && npm run keys:rotate -- --dry-run       # expect: re-wrapped 0 everywhere

# 3. Remove. Deploy without KMS_MASTER_KEY_PREVIOUS.
```

**What `keys:rotate` does** (`backend/src/services/keyRotation.service.js`): walks every row of each table in
id order, in batches; touches only a row that is a `v1` envelope or a `v2` envelope under another key (or a
legacy AES-CBC signing key); decrypts it with its own tenant id, re-encrypts under the current key, writes it with
an optimistic predicate (`AND <column> = <what was read>` — a row the application rewrote meanwhile is skipped,
not clobbered), then **re-reads it and decrypts it again** to prove it holds the same secret. It is safe to
interrupt and re-run. Soft-deleted rows are included.

**Failure handling.** A row that fails is reported by id and left as it was; the run exits 1 and says to keep the
previous key. Fix and re-run. Never do step 3 on a run that did not end `failed 0` and `skipped 0`.

**Verify with psql:**

```sql
SELECT split_part(value, ':', 1) AS format, split_part(value, ':', 2) AS key_id, count(*)
  FROM tenant_settings WHERE value LIKE 'v_:%' GROUP BY 1, 2;
-- and the same for webhooks.secret and tenant_keys.private_key
```

---

## `ENCRYPT_KEY` — retired by re-encryption

**Was** the AES-256-**CBC** key (no MAC, no tenant binding, no key id) for `tenant_keys.private_key`.
**Now:** migration **0058** decrypts each such row, checks the result parses as a private key, re-encrypts it
as a KMS envelope under its own tenant, re-reads and verifies it — in one transaction; any row it cannot convert
fails the migration by id and changes nothing (`backend/src/migrations/0058-tenant-keys-kms-envelope.js`).
New keys are never written in the old form (`backend/src/services/signingKeyWrap.service.js`).

- **Before deploying 0058:** `ENCRYPT_KEY` must be the value the rows were written under. If it was ever changed
  by hand, put the older value(s) in `ENCRYPT_KEY_PREVIOUS`.
- **After:** `npm run keys:rotate -- --dry-run` must report `tenant_keys: … converted from legacy 0`. From then on
  `ENCRYPT_KEY` is read only for a row restored from a pre-0058 backup. **Keep it backed up** for as long as such
  backups are retained; it can leave the running configuration once that is accepted.
- **Rollback of 0058:** `npm run migrate:undo` (host) reverts the LAST applied migration, so undo whatever came
  after 0058 first (0059 at the time of writing). 0058's `down` writes every envelope back as AES-CBC under
  `ENCRYPT_KEY` — the only form the pre-0058 code reads — and refuses without `ENCRYPT_KEY`.

---

## JWT access keys — `JWT_ACCESS_SECRET` / `JWT_PRIVATE_KEY`

(`backend/src/utils/jwt.util.js`, S-26.) The key ring is the environment, read when used, identical on every
replica. Every access and purpose token carries `kid` = the fingerprint of its **verification** key; the verifier
tries the key the kid names, or every key for a token with no or an unknown kid (tokens issued before S-26 carry
`kid: "default"`). The algorithm is always `JWT_ALGORITHM` — there is no HS256 fallback. **No key expires by the
clock**; the 30-day in-process expiry that stopped non-HS256 deployments after a month of uptime is gone.

| `JWT_ALGORITHM` | current | previous (verify only) |
|---|---|---|
| `HS256` / `HS384` / `HS512` | `JWT_ACCESS_SECRET` | `JWT_ACCESS_SECRET_PREVIOUS` |
| `RS*` / `ES*` | `JWT_PRIVATE_KEY` (sign) + `JWT_PUBLIC_KEY` (verify; derived from the private key when unset) | `JWT_PUBLIC_KEY_PREVIOUS` |

**Procedure:** set the new key, move the old one to `*_PREVIOUS`, deploy; wait one access-token lifetime
(`JWT_ACCESS_EXPIRED`, and 24 h for activation links, which are signed with the same key); remove `*_PREVIOUS`.
Nobody is logged out: refresh tokens are opaque and stored, and a refresh mints an access token under the new key.

**Emergency (the key is known to be compromised):** skip the previous key. Every access token in flight is
refused at once; users refresh (opaque refresh tokens are unaffected) or sign in again. Revoke sessions as well
if the refresh path is also suspected (`docs/SECURITY/12-INCIDENT-RESPONSE.md`).

**Changing the algorithm** (e.g. HS256 → RS256) is not a rotation: tokens of the old algorithm are refused
immediately. Plan it as an emergency rotation.

`JWT_REFRESH_SECRET` signs only the legacy JWT refresh token, which the login flow does not issue: rotating it
invalidates nothing in use.

---

## `CERT_SIGNING_SECRET`

**No issued certificate depends on it** (A-241). `generateCertificatePdf` computes an HMAC over the integrity
hash and returns it; nothing stores, prints or verifies it. Public verification (`/certificates/verify/:number`)
recomputes the **unkeyed** integrity hash from the database row. The secret also keys two short-lived capability
links — the public document link (`mintDocumentUrl`) and, when `ATTACHMENT_URL_SECRET` is unset, signed download
URLs — which stop validating when it changes. So: **replace it and restart**; the cost is links minted in the last
few minutes.

**Versioning design, for when a signature is persisted.** The HMAC now reports the key that made it:
`SIGNATURE_KEY_ID = "hmac-sha256:<keyId>"` (`certificatePdf.service.js`), returned with the signature as
`signatureKeyId`. Any change that starts storing or printing the signature must store that id beside it and verify
by selecting the key it names from `CERT_SIGNING_SECRET` + a `CERT_SIGNING_SECRET_PREVIOUS` list — the same ring
shape as the KMS. An old certificate then verifies against the key it was issued under, forever, as long as that key
stays in the ring. Until something persists a signature, adding that verifier would be code with no caller — the
S-26 mistake.

`ATTACHMENT_URL_SECRET`: replace and restart; only links in flight (default TTL 300 s) are affected.

---

## What has NOT been done

- **No rehearsal against a copy of production data.** The PG16 rehearsal seeds v1 envelopes, legacy CBC signing
  keys, runs 0058, rotates A → B, reads everything back with only B, interrupts and resumes a rotation, and runs
  0058 `down`. The production copy will have volumes, malformed legacy rows and backups this does not.
- **No external KMS.** The "KMS" is a key in the environment. Moving the master key into a real KMS/HSM is a
  separate decision; the envelope format already names its key, which is what such a move needs.
- **The Helm chart** carries `KMS_MASTER_KEY` but no `KMS_MASTER_KEY_PREVIOUS` / `JWT_*_PREVIOUS` fields: set them
  through `global.secrets.external` or by editing the Secret until the chart grows them.
