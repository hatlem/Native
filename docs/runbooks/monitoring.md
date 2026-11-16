# Monitoring and alerting

What to watch, where the signal comes from, and what to do when it fires.
Nothing here is set up by the repository itself: the endpoints and log events
exist, the monitors that call them are a one-time job for the owner
(**VERIFY** = must be done or confirmed outside the repo).

## The signals the app provides

| Signal | Where | Auth | Meaning |
|---|---|---|---|
| Liveness | `GET /api/health` | none | 200 `{"status":"ok","db":"ok"}` when the process is up and the database answers; 503 otherwise. Railway's own healthcheck uses it. |
| Deep health | `GET /api/health/deep` | `Authorization: Bearer $CRON_SECRET` | Database, pending/failed migrations, job-queue lag, dead letters, freshness of each sweep. 200 for `ok`/`degraded`, 503 for `fail`; add `?strict=1` to get 503 on `degraded` too. 404 while `CRON_SECRET` is unset. |
| Error alerts | `ERROR_WEBHOOK_URL` | — | Every error-level log line is posted to this Slack/Discord webhook (rate-limited to 5 per 5 minutes). Includes `request.unhandled_error`, `sweep.crashed`, `sweep.partial_failure`, `job.dead_lettered`, `accounting.push_failed`, `invoice.archive_failed`. |
| Job queue | `/desk/jobs` | desk sign-in | Waiting / running / failed counts, the failed jobs with their last error, and the sweep run history. |
| Logs | Railway log search | — | One JSON object per line; filter on `event`, `level`, `requestId`. |

The thresholds behind `degraded` live in [`src/lib/health.ts`](../../src/lib/health.ts)
and are unit-tested: a due job waiting more than 15 minutes, any dead-lettered
job, an hourly sweep without a success for 3 hours, a daily sweep without a
success for 36 hours.

## Monitors to set up (VERIFY — one time)

Use any external uptime service (Better Stack, UptimeRobot, Checkly, a
Railway cron that pings a dead-man's-switch — anything that runs outside the
app's own infrastructure).

1. **Uptime** — `GET https://nativespin.com/api/health` every minute from at
   least two regions. Alert after 2 consecutive failures. Page a human.
2. **Deep health** — `GET https://nativespin.com/api/health/deep?strict=1`
   with the bearer header, every 5 minutes. Alert after 3 consecutive
   failures (15 minutes). Notify during working hours; page if the response
   body says `"status":"fail"`.
3. **Error webhook** — set `ERROR_WEBHOOK_URL` in Railway to a channel a
   human actually reads. Without it, every alert below is only a log line.
4. **Front page** — `GET https://nativespin.com/en` expecting 200 and the
   word "NativeSpin" in the body, every 5 minutes. Catches a broken build
   that still passes the API health check.
5. **Certificate and domain expiry** — most uptime services include it; turn
   it on for `nativespin.com`.
6. **Job drain** (only if `JOB_WORKER=0`) — a scheduler must
   `POST /api/cron/sweeps?only=jobs` every minute; alert when that cron
   fails. With the default in-process poller this is not needed.

Record here when each was set up:

| Monitor | Set up on | By | Alert goes to |
|---|---|---|---|
| Uptime | never | | |
| Deep health | never | | |
| Error webhook | never | | |
| Front page | never | | |
| Certificate | never | | |

## Suggested service levels

Targets to measure against, not promises made to customers — nothing in the
terms commits to them. Start measuring before publishing any number.

| Objective | Target | Measured by |
|---|---|---|
| Availability of the app (`/api/health` and `/en`) | 99.5 % per calendar month (≈ 3 h 40 min of downtime) | uptime monitor |
| Queued work starts on time | 99 % of jobs start within 5 minutes of being due | `/api/health/deep` → `jobQueue` |
| No silent failures | 0 dead-lettered jobs older than one working day | `/desk/jobs`, `job.dead_lettered` alerts |
| Sweeps run | every hourly sweep succeeds at least once per 3 hours | `/api/health/deep` → `sweep:*` |
| Desk response to a request | first quote or reply within one working day (the public promise on `/help`) | `/desk/requests` |

Page response time (p95 per route) is not measured anywhere yet. Railway's
metrics give CPU and memory only; add an APM or log-derived latency before
setting a latency objective.

## When an alert fires

| Alert | First look | Usual cause | Action |
|---|---|---|---|
| Uptime down | Railway deploy log and service status | failed deploy, database unreachable | [rollback.md](./rollback.md) if it started with a deploy; otherwise [incident.md](./incident.md) |
| Deep health `fail`, migrations pending | `prisma migrate status` against production | the pre-deploy migration step failed or was skipped | fix forward: run `pnpm prisma migrate deploy`; do not serve new code on an old schema |
| Deep health `degraded`, `jobQueue` | `/desk/jobs` "Oldest waiting" | no worker is polling (`JOB_WORKER=0` without a cron, or the process is restarting in a loop) | restore the poller or the cron; queued jobs are not lost and run when a worker returns |
| `job.dead_lettered` | `/desk/jobs` → Failed jobs → last error | `webhook.deliver`: the partner's endpoint is down or rejects the payload. `email.send`: Resend is down or the key is wrong. `invoice.archive`: R2 credentials. `accounting.sync-*`: Fiken refused the document | fix the cause, then **Retry** (super admin). **Discard** only when the work is no longer wanted |
| `sweep.crashed` / `sweep.partial_failure` | the log line's `sweep` and `summary`; `/desk/jobs` sweep history | a third party failed mid-batch | the next hourly tick retries; investigate if it repeats |
| Deep health `degraded`, `sweep:*` stale | sweep history on `/desk/jobs` | timers off (`IN_PROCESS_SWEEPS=0`) and the cron is not running; or the sweep's kill switch is set | re-enable the scheduler |
| `request.unhandled_error` | search the log for the `requestId` | a bug | reproduce with the `path` in the log line; the customer saw the error page with the same digest |

## What is not covered

- No status page for customers. If one is wanted, most uptime services host
  one from the same monitors.
- No on-call rota: alerts reach whoever reads the webhook channel.
- No tracing or per-route latency.
- Queue retention: finished jobs are deleted after 30 days, sweep history
  after 90 — long enough for an incident review, not an archive.
