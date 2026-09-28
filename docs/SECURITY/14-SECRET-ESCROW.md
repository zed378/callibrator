# 14 — Secret Escrow and Restore

> As-built 2026-09-28 (P7-05, ADR-078). Proven in the P7-04 restore drill on PostgreSQL 18
> (`MEMORY/records/2026-09-27-p7-04-restore-drill.md`). Source files are named in each section.

A backup of the database without the keys it was written under is a backup of **ciphertext**. This
document is what must be escrowed, where, and how it is put back. The database procedure is
[`../DEVOPS/04-DATABASE-BACKUP.md`](../DEVOPS/04-DATABASE-BACKUP.md); rotation is
[`13-KEY-ROTATION.md`](13-KEY-ROTATION.md).

---

## What must be escrowed

Measured in the drill, not assumed: each secret below was replaced by a fresh value on a restored
database and the checklist re-run.

| Secret | Class | What losing it did in the drill |
|---|---|---|
| **`KMS_MASTER_KEY`** (and every `KMS_MASTER_KEY_PREVIOUS` still named by a stored value or a retained backup) | **ESCROW — unrecoverable** | Every wrapped value is gone: tenant e-signature private keys (no new signature can be made), webhook secrets, tenant SSO/OIDC/Stripe/storage/AI credentials, **and every user's TOTP seed** (since migration 0086 — an MFA sign-in answers 500, which locks out the super administrator, who must have MFA, P6-07). Since ADR-078 the backend **refuses to boot** instead of starting and failing per request |
| **`ENCRYPT_KEY`** (and `ENCRYPT_KEY_PREVIOUS`) | **ESCROW while a pre-0058 backup is retained** | Nothing on a post-0058 database (the drill removed it: all checks passed). A database restored from a backup taken **before** migration 0058 holds AES-CBC signing keys that only this key opens; 0058 refuses the boot without it |
| `DB_PASS` | escrow (or reset) | A volume-level restore carries the role's password hash; a dump restore does not. Resettable by an administrator with local access — not a loss, a delay |
| `CERT_SIGNING_SECRET` | regenerate on loss | **Nothing broke.** Every issued certificate still verified (identical integrity hashes) and its public document downloaded: public verification is the unkeyed integrity hash plus the database (A-241). Only document links minted in the last minutes stop working |
| `ATTACHMENT_URL_SECRET` | regenerate on loss | Nothing stored depends on it: fresh signed URLs worked for every attachment. Links in flight (TTL 300 s) stop |
| `JWT_ACCESS_SECRET` / `JWT_PRIVATE_KEY`, `JWT_REFRESH_SECRET` | regenerate on loss | Every access token in flight is refused; users sign in again. Nothing stored depends on them |
| `REDIS_PASSWORD`, `RABBITMQ_PASS` | regenerate on loss | Redis holds nothing that needs restoring; RabbitMQ creates its user on first boot of an empty volume |
| `STRIPE_*`, `MAIL_PASSWORD`, `OPENAI_API_KEY`, S3 keys | re-issue from the provider | Held by the provider, not by us |
| OIDC provider signing key | none | Generated per process (`services/oidcProvider.service.js`); not persisted, nothing to escrow |

**Two secrets are unrecoverable. Everything else is regenerate-on-loss.** An earlier version of
[`../DEVOPS/04-DATABASE-BACKUP.md`](../DEVOPS/04-DATABASE-BACKUP.md) and
[`../ARCHITECTURE/09-DISASTER-RECOVERY.md`](../ARCHITECTURE/09-DISASTER-RECOVERY.md) named
`CERT_SIGNING_SECRET` as the one that ends recoveries and left `KMS_MASTER_KEY` out: both were wrong
since A-241 and P6-10, and the drill showed it (ADR-078).

## How the escrow is kept

1. **Separately from the database backups and separately from the host.** A copy on the same disk,
   in the same bucket or in the same backup job as the dump is not escrow.
2. **Two custodians, one record.** Store the values in a secrets manager or password vault the
   operations team controls (a sealed offline copy is acceptable for a single-host deployment). Every
   read is logged by that system; the escrow is read only during a restore or a rotation.
3. **By key id.** Record next to each KMS key its key id — `npm run keys:rotate -- --dry-run` prints
   it; it is a fingerprint, safe to write down (`utils/keyring.util.js`). The restore's boot check names
   the key id it needs; the id is how the right key is found.
4. **Keep every key a retained backup needs.** After a rotation the old `KMS_MASTER_KEY` is no longer
   in the running configuration, but every backup taken before the rotation is under it. Keep it in
   escrow for as long as the longest backup retention (the monthly dumps: 12 months), labelled with the
   date range it covers. The same for `ENCRYPT_KEY` and pre-0058 backups.
5. **Verify the escrow when the backup is verified.** The monthly restore test (04 § Verify the
   Backup) restores the escrowed secrets too — a boot that passes `[kms-verify] OK` proves the escrowed
   key matches the data.

## Restore

The order is in [`../DEVOPS/04-DATABASE-BACKUP.md`](../DEVOPS/04-DATABASE-BACKUP.md) § Restore Order.
The secrets step, concretely, for compose:

```bash
# 1. the compose .env, rebuilt from the escrowed values (the host's .env was lost with the host)
cp deploy/compose/.env.example deploy/compose/.env    # then set every value from the escrow
# 2. start the backend; its boot checks the key ring against the database
make up
make logs SERVICE=backend | grep kms-verify
#   [kms-verify] OK: N stored envelope(s), every one under a configured master key
```

### What a wrong or missing KMS key does (ADR-078)

`utils/kmsVerify.util.js` runs at every boot, after the schema verification. For each column
`keys:rotate` re-wraps (`services/keyRotation.service.js` `TARGETS`: `tenant_settings.value`,
`webhooks.secret`, `tenant_keys.private_key`, `users.mfa_secret`, `users.mfa_pending_secret`) it
checks that every `v2:<keyId>:` envelope names a key in the ring, and decrypts one `v1:` envelope as a
sample. Any miss **refuses the boot**, naming the table, the count and the missing key id:

```
[kms-verify] UNREADABLE: tenant_keys.private_key: 5 value(s) wrapped under KMS master key 917befe5f6728d2f, which is not configured
[kms-verify] FAILED: the database holds secrets the configured KMS master keys cannot open. …
```

Fix: put the escrowed key back as `KMS_MASTER_KEY` (or into `KMS_MASTER_KEY_PREVIOUS` beside a newer
current key) and restart.

**If the key is truly lost**, `KMS_VERIFY=warn` lets the boot continue with every unreadable value
logged at error level. What then works and what does not was measured in the drill:

| Works | Does not |
|---|---|
| `/health` 200, password sign-in without MFA, every list, public certificate verification and document, attachments, verifying existing e-signatures (public keys are not encrypted) | an MFA sign-in (500), signing (500, "tenant signing key could not be decrypted"), webhook delivery, SSO, any tenant credential |

Recovery from a lost key is re-issuing every secret it protected: new tenant signing key pairs, new
webhook secrets (`POST /webhooks/:id/rotate-secret`), tenant credentials re-entered, and every user's
MFA reset (`src/scripts/breakGlassMfaReset.js` for the super administrator). Existing signatures stay
verifiable. `KMS_VERIFY=warn` is for that window only; remove it once the re-issue is done.

## What has not been done

- **No external KMS.** The master key is an environment variable. Escrow is therefore a procedure, not
  a mechanism; nothing in the repository enforces it or audits reads of it.
- **The Helm chart** carries `KMS_MASTER_KEY` but not `KMS_VERIFY` or the `*_PREVIOUS` fields; set them
  through `global.secrets.external`.
- **The drill ran on compose only.** A Kubernetes restore has not been rehearsed (P7-06).
