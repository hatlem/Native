# Rollback a bad deploy

`main` auto-deploys to Railway. Each deploy runs
`pnpm prisma migrate deploy` (`preDeployCommand` in `railway.json`) and then
starts `pnpm next start`; Railway only switches traffic when `/api/health`
answers 200 (it checks the database).

## Decide in two minutes

| Symptom | Action |
|---|---|
| New deploy never became healthy | Nothing to roll back — Railway kept the old version. Read the deploy log, fix forward. |
| Site is up but a feature is broken | Roll back the **app** (section 1). |
| Errors mention a missing column/table, or data is being written wrongly | Roll back the app, then deal with the **schema** (section 2). |
| A background sweep is misbehaving (wrong emails going out) | Kill switch first (section 3), then roll back. |

## 1. Roll back the application (minutes)

1. Railway → app service → *Deployments* → the last deployment that was
   healthy → **Redeploy** (or *Rollback*). This redeploys that build; it
   does **not** touch the database.
2. Watch the deploy log until the healthcheck passes, then:

   ```bash
   curl -fsS https://nativespin.com/api/health   # {"status":"ok","db":"ok"}
   ```
3. Stop the bleeding in git so the next push does not redeploy the bad
   commit:

   ```bash
   git revert <bad-sha>      # a new commit; never force-push main
   git push origin main
   ```

   **VERIFY** in Railway whether the redeployed old build stays pinned or
   whether the next push to `main` redeploys — it does the latter by
   default, which is why the revert must land.

## 2. The schema

Migrations are forward-only: Prisma has no `down`. Whether an app rollback
is safe depends on what the bad deploy's migration did.

- **Additive migration** (new table, new nullable column, new index): the
  previous app version ignores it. Roll back the app and leave the schema.
- **Destructive migration** (dropped/renamed column, changed enum, tightened
  constraint): the previous app version may now fail. Options, best first:
  1. Fix forward: ship a migration that restores what the old code needs.
  2. Write the inverse by hand and apply it as a new migration. Several
     migrations carry a "reverse with" comment at the top — check
     `prisma/migrations/<name>/migration.sql`.
  3. Restore from backup ([backup-restore.md](./backup-restore.md)) — loses
     everything written since.

  Dropped data is gone unless a snapshot was taken first
  ([backup-restore.md §1](./backup-restore.md)).
- **A migration failed half-way** (deploy log: `migrate deploy` error; the
  old version is still serving):

  ```bash
  pnpm prisma migrate status                      # shows the failed migration
  # after fixing the database by hand OR deciding to skip it:
  pnpm prisma migrate resolve --rolled-back <migration_name>   # will be retried
  pnpm prisma migrate resolve --applied <migration_name>       # treat as done
  ```

To avoid ever being here, schema changes follow expand/contract
([CONTRIBUTING.md](../../CONTRIBUTING.md)).

## 3. Kill switches (no deploy needed beyond a variable change)

Set in Railway → Variables; the service restarts with the new value.

| Variable | Effect |
|---|---|
| `AUTOSEND_SWEEP=0` | Stops scheduled programme waves being sent |
| `METRICS_SWEEP=0` | Stops metrics-request emails |
| `PLACEMENT_READY_SWEEP=0` | Stops placement-ready notifications |
| `PRICE_BAND_SWEEP=0` | Stops price-band recomputation |
| `IN_PROCESS_SWEEPS=0` | Stops every in-process timer at once |
| `OUTREACH_DAILY_CAP=0` | **VERIFY** this halts outreach sending (read `src/lib/rate-limit.ts` before relying on it) |
| `RESEND_API_KEY` removed | No email leaves the system at all (it is only logged) |

## 4. Rollback drill (quarterly, together with the restore drill)

1. Deploy a harmless change (a comment).
2. Roll back to the previous deployment in Railway; time it.
3. Confirm `/api/health` and one signed-in page.
4. Log it.

| Date | Who | Time to roll back | Problems found |
|---|---|---|---|
| _never run_ | | | |
