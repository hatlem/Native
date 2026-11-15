# Incident response

## Severity

| Level | Meaning | Examples | Respond within |
|---|---|---|---|
| SEV1 | Customers cannot use the product, or data is exposed/lost | Site down; one customer can see another's data; wrong invoices sent; leaked credential | Immediately |
| SEV2 | A core flow is broken for some | Sign-in emails not arriving; quotes cannot be accepted; a sweep sending wrong mail | 1 hour (working hours) |
| SEV3 | Degraded, workaround exists | PDF export failing; AI recommendations off | Next working day |

## First 15 minutes

1. **Acknowledge** in the incident channel: what is seen, since when, who is
   on it. One person leads; everyone else asks before touching production.
2. **Stop the harm before finding the cause.**
   - Bad deploy → [rollback.md](./rollback.md).
   - Wrong emails going out → kill switches in rollback.md §3.
   - Data exposure → take the affected route down (roll back, or revoke the
     key/session involved) *before* investigating.
   - Leaked secret → rotate it now (section "Rotating secrets").
3. **Look.**
   - `GET /api/health` — is the database reachable?
   - Railway → app service → *Logs*. Logs are JSON, one event per line:
     filter on `"level":"error"`, on an `event` name (`request.unhandled_error`,
     `sweep.crashed`, `accounting.push_failed`, `webhook.delivery_failed`), or
     on the `requestId` the user's browser received in the `x-request-id`
     response header. The "Error reference" on the error page is the `digest`
     in `request.unhandled_error`.
   - Railway → *Deployments*: did something ship just before it started?
   - Railway → Postgres → *Metrics*: connections, CPU, disk.
   - Third parties: Resend status, Cloudflare status, Railway status.
4. **Write the timeline as you go** (UTC times, what was seen, what was done).

## Who must be told

| Situation | Who | Deadline |
|---|---|---|
| Personal data breach (someone saw, lost or altered personal data they should not have) | **Datatilsynet**, via Altinn | 72 hours after becoming aware (GDPR art. 33), unless the breach is unlikely to result in a risk — document that assessment either way |
| Breach with high risk to individuals | The affected people | Without undue delay (art. 34) |
| Customer data affected, we are their processor | The customer (per the DPA) | Without undue delay |
| Outage or degraded service | Affected customers; status page if one exists | Within the hour for SEV1 |
| Wrong invoice / credit note issued | The customer and the accountant | Same day |

Keep the facts: what data, how many people, from when to when, what was done.

## Rotating secrets

| Secret | How |
|---|---|
| `AUTH_SECRET` | New value in Railway → redeploy. Signs sessions: **everyone is signed out**. |
| A user's sessions | Changing the password or deactivating the user bumps `sessionVersion` and revokes them. |
| API key (`ApiKey`) | `/desk/api-keys` → revoke → issue a new one to the partner. |
| `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET` | Rotate in Resend, update Railway. |
| R2 keys | Rotate the token in Cloudflare, update `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY`. |
| `DATABASE_URL` password | Rotate in Railway's Postgres service; the app variable follows the reference. |
| `CRON_SECRET`, `ERROR_WEBHOOK_URL`, `FEEDBACK_INGEST_KEY`, `GETPLATFORM_*`, `FIKEN_API_TOKEN` | Rotate at the provider, update Railway. |

After any credential leak: check the `AuditLog` table and provider logs for
use of the old credential between the leak and the rotation.

## Afterwards — blameless postmortem (within 5 working days for SEV1/SEV2)

Write `docs/postmortems/YYYY-MM-DD-<slug>.md`:

1. Summary (two sentences) and impact (who, how long, what data).
2. Timeline (UTC).
3. What made it possible — systems and gaps, never a person's name.
4. What went well / what was slow (detection, diagnosis, fix).
5. Actions, each with an owner and a date. Add a test or an alert for the
   thing that would have caught it.

## Detection — what exists today

- Unhandled request errors, crashed or partially failed sweeps and other
  error-level events are logged as JSON and, when `ERROR_WEBHOOK_URL` is set,
  posted to that channel (rate-limited to 5 per 5 minutes).
- Railway restarts the service on failure and gates deploys on `/api/health`.
- **Not in the repo — the owner must set up:** an external uptime monitor on
  `/api/health` and the home page, alert routing to a phone, and a public
  status page.
