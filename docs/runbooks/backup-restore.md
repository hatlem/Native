# Backup and restore (PostgreSQL)

The production database is the Railway Postgres service behind
`DATABASE_URL`. It holds everything that cannot be re-derived: customers,
requests, quotes, orders, invoices, the audit log, the catalog and prices.
Blobs (rate cards, quote PDFs, article uploads) are in the R2 bucket `R2_BUCKET`.

## Targets

| | Target | Notes |
|---|---|---|
| RPO (max data loss) | 24 h with daily backups; minutes with point-in-time recovery | **VERIFY** which one the Railway plan actually provides |
| RTO (max downtime) | 2 h | Measured by the restore drill below — replace with the real number |

## 0. One-time setup — the owner must confirm each line

- [ ] **VERIFY** Railway → Postgres service → *Backups*: a daily schedule is
      enabled and retention is at least 7 days. (Backups are a plan feature;
      if the tab is absent, they are not being taken.)
- [ ] **VERIFY** whether point-in-time recovery is available on the plan.
- [ ] An **off-platform** copy exists: Railway backups live in the same
      account as the database. Set up the nightly dump below.
- [ ] **VERIFY** R2 bucket → *Settings* → object versioning or a lifecycle
      rule protects against accidental deletes.
- [ ] A restore has been rehearsed (section 3) and logged (section 5).

### Nightly off-platform dump

Run from a scheduler that is not the app (GitHub Actions cron, or a Railway
cron service with its own credentials). `pg_dump` must be the same major
version as the server (16).

```bash
# DATABASE_URL = the production connection string (public/proxy URL)
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
pg_dump "$DATABASE_URL" --format=custom --no-owner --no-acl \
  --file "nativespin-$STAMP.dump"
# verify the archive is readable before trusting it
pg_restore --list "nativespin-$STAMP.dump" > /dev/null
# encrypt, then copy off-platform (example: a private R2 bucket via the S3 API)
age -r "$BACKUP_AGE_RECIPIENT" -o "nativespin-$STAMP.dump.age" "nativespin-$STAMP.dump"
aws s3 cp "nativespin-$STAMP.dump.age" "s3://$BACKUP_BUCKET/postgres/" \
  --endpoint-url "https://$R2_ACCOUNT_ID.r2.cloudflarestorage.com"
```

Keep 14 daily and 12 monthly copies. The dump contains personal data
(contacts, users, audit IPs): it must be encrypted and the bucket private.

## 1. Before any risky change: take a manual snapshot

Before a destructive migration or a one-off data script against production:

```bash
pg_dump "$DATABASE_URL" --format=custom --no-owner --no-acl \
  --file "pre-change-$(date -u +%Y%m%dT%H%M%SZ).dump"
```

(`*.dump` is gitignored. Delete the file when the change has been verified —
it is a full copy of customer data on a laptop.)

## 2. Restore — production data loss or corruption

1. **Stop the writes.** Railway → app service → *Settings* → scale to 0
   replicas / pause, or set a maintenance deploy. A restore under live writes
   loses those writes and can deadlock.
2. **Decide the restore point.** From the incident timeline: the last moment
   the data was known good. Everything after it is lost — say so in the
   incident channel before continuing.
3. **Restore into a NEW database, never over the broken one.**
   - Railway backup: Postgres service → *Backups* → pick the backup →
     *Restore*. **VERIFY** whether this replaces the volume in place or
     creates a new service on your plan; if it is in place, first take a
     manual `pg_dump` of the broken state (it is evidence, and may hold rows
     newer than the backup).
   - Off-platform dump: create a new Postgres service in Railway, then

     ```bash
     age -d -i backup.key nativespin-<stamp>.dump.age > restore.dump
     pg_restore --dbname "$NEW_DATABASE_URL" --no-owner --no-acl \
       --clean --if-exists --jobs 4 restore.dump
     ```
4. **Check the restored database before pointing the app at it.**

   ```bash
   psql "$NEW_DATABASE_URL" -c 'select count(*) from "Organization"' \
     -c 'select count(*) from "Order"' -c 'select count(*) from "Invoice"' \
     -c 'select max("createdAt") from "AuditLog"' \
     -c 'select migration_name from _prisma_migrations order by finished_at desc limit 1'
   ```

   The newest migration must match what the code you are about to run
   expects. If the code is ahead, `pnpm prisma migrate deploy` (the
   pre-deploy step does this) brings the schema forward.
5. **Switch.** Set the app's `DATABASE_URL` to the new database, deploy,
   confirm `GET /api/health` returns `{"status":"ok","db":"ok"}`, scale back up.
6. **Reconcile what the restore lost.** Emails sent, invoices issued and
   Fiken pushes made after the restore point exist outside the database:
   compare with Resend's log and the accounting system, and re-create the
   rows by hand. Invoice numbers already sent to customers must not be reused.
7. Keep the broken database for 30 days, then delete it.

## 3. Restore drill (quarterly)

A backup that has not been restored is not a backup. Once a quarter:

1. Take the newest off-platform dump.
2. Restore it into a throwaway Postgres (local docker is fine:
   `docker compose up -d db`, then `pg_restore` as above).
3. Run the checks from step 2.4 and `pnpm prisma migrate status` against it.
4. Start the app against it (`ALLOW_LOCAL_DB=1 pnpm dev`) and sign in.
5. Time the whole thing — that number is the real RTO — and log it below.
6. Destroy the throwaway database.

## 4. R2 objects

Deleted or overwritten blobs are recovered from R2 object versioning
(**VERIFY** it is enabled). Quote PDFs can be regenerated from the database;
publisher rate cards and article uploads cannot.

## 5. Drill log

| Date | Who | Backup used | Time to restore | Problems found |
|---|---|---|---|---|
| _never run_ | | | | |
