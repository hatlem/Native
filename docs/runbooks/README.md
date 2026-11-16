# Runbooks

Step-by-step procedures for production incidents on NativeSpin
(Railway + PostgreSQL + Cloudflare R2 + Resend).

| Runbook | Use it when |
|---|---|
| [backup-restore.md](./backup-restore.md) | Data was lost or corrupted; or for the quarterly restore drill |
| [rollback.md](./rollback.md) | A deploy broke production and must be undone |
| [incident.md](./incident.md) | Anything is on fire: who does what, in which order, who must be told |
| [monitoring.md](./monitoring.md) | Setting up uptime checks and alerts; what each alert means and what to do |

**Status of these documents.** They were written from the repository
(`railway.json`, the Prisma migrations, the code) — not from a rehearsal.
Every step marked **VERIFY** depends on a Railway/Cloudflare setting that
cannot be read from the repo and must be confirmed by the owner once. A
runbook that has never been executed is a hypothesis: run the drills in
each file and record the date in its drill log.
