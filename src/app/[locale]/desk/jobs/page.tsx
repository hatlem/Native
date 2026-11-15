import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { requireDesk } from "@/lib/desk-guard";
import { prisma } from "@/lib/prisma";
import { Link } from "@/i18n/navigation";
import { intlLocale } from "@/lib/money";
import { queueStats } from "@/lib/jobs";
import { SubmitButton, ConfirmSubmit } from "@/components";
import { retryJob, discardJob } from "@/app/job-actions";

export const dynamic = "force-dynamic";

const RECENT = 50;
const DEAD_SHOWN = 100;
const SWEEP_RUNS = 40;
const ERROR_PREVIEW = 240;

function minutes(ms: number): string {
  const m = Math.round(ms / 60_000);
  return m < 1 ? "<1 min" : m < 120 ? `${m} min` : `${Math.round(m / 60)} h`;
}

// The job queue and the sweep history, readable. Before this page a failed
// webhook delivery or email was a log line; now it is a row someone can retry.
// Desk can read; only a super admin can retry or discard (a retry re-sends).
// Payloads are never shown — a queued email's payload is the message itself.
export default async function DeskJobsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  // The desk layout guard alone is not an authorization boundary.
  await requireDesk(locale);
  const t = await getTranslations({ locale, namespace: "deskJobs" });
  const td = await getTranslations({ locale, namespace: "desk" });
  const session = await auth();
  const isSuperadmin = session?.user?.role === "SUPERADMIN";
  const sp = await searchParams;
  const flash = typeof sp.ok === "string" ? sp.ok : "";

  const [stats, dead, recent, sweeps] = await Promise.all([
    queueStats(),
    prisma.job.findMany({
      where: { status: "FAILED" },
      orderBy: [{ finishedAt: "desc" }, { id: "desc" }],
      take: DEAD_SHOWN,
      select: { id: true, kind: true, attempts: true, lastError: true, createdAt: true, finishedAt: true },
    }),
    prisma.job.findMany({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: RECENT,
      select: { id: true, kind: true, status: true, attempts: true, maxAttempts: true, runAt: true, createdAt: true },
    }),
    prisma.sweepRun.findMany({
      orderBy: [{ startedAt: "desc" }, { id: "desc" }],
      take: SWEEP_RUNS,
    }),
  ]);

  const when = new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: "medium", timeStyle: "short" });
  const flashText =
    flash === "retried" ? t("flashRetried") : flash === "discarded" ? t("flashDiscarded") : flash === "gone" ? t("flashGone") : "";

  return (
    <>
      <nav className="breadcrumb">
        <Link href="/desk" className="small-link">
          ← {td("title")}
        </Link>
      </nav>

      <header className="page-header">
        <span className="eyebrow accent">{t("eyebrow")}</span>
        <h1>{t("title")}</h1>
        <p className="lead">{t("lead")}</p>
      </header>

      {flashText ? (
        <p className="banner-success" role="status">
          {flashText}
        </p>
      ) : null}

      <div className="kpi-grid">
        <div className="kpi">
          <div className="label">{t("statPending")}</div>
          <div className="value">{stats.pending}</div>
        </div>
        <div className="kpi">
          <div className="label">{t("statRunning")}</div>
          <div className="value">{stats.running}</div>
        </div>
        <div className="kpi">
          <div className="label">{t("statDead")}</div>
          <div className="value">{stats.dead}</div>
        </div>
        <div className="kpi">
          <div className="label">{t("statOldest")}</div>
          <div className="value">{stats.oldestDueAgeMs === null ? "—" : minutes(stats.oldestDueAgeMs)}</div>
          {stats.oldestDueAgeMs === null ? <div className="delta">{t("oldestNone")}</div> : null}
        </div>
      </div>

      <section className="section">
        <div className="section-head">
          <div>
            <h2>{t("deadTitle")}</h2>
          </div>
          <span className="muted small">{t("deadLead")}</span>
        </div>
        {dead.length === 0 ? (
          <p className="muted">{t("deadNone")}</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">{t("colKind")}</th>
                  <th scope="col">{t("colAttempts")}</th>
                  <th scope="col">{t("colLastError")}</th>
                  <th scope="col">{t("colCreated")}</th>
                  <th scope="col">{t("colFinished")}</th>
                  <th scope="col">
                    <span className="sr-only">{t("retry")}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {dead.map((j) => (
                  <tr key={j.id}>
                    <td data-label={t("colKind")}>
                      <code>{j.kind}</code>
                    </td>
                    <td data-label={t("colAttempts")}>{j.attempts}</td>
                    <td data-label={t("colLastError")} className="muted small" title={j.lastError ?? undefined}>
                      {(j.lastError ?? "—").slice(0, ERROR_PREVIEW)}
                    </td>
                    <td data-label={t("colCreated")}>{when.format(j.createdAt)}</td>
                    <td data-label={t("colFinished")}>{j.finishedAt ? when.format(j.finishedAt) : "—"}</td>
                    <td>
                      {isSuperadmin ? (
                        <span className="cluster tight">
                          <form action={retryJob}>
                            <input type="hidden" name="locale" value={locale} />
                            <input type="hidden" name="jobId" value={j.id} />
                            <SubmitButton label={t("retry")} pendingLabel={t("working")} className="btn small" />
                          </form>
                          <form action={discardJob}>
                            <input type="hidden" name="locale" value={locale} />
                            <input type="hidden" name="jobId" value={j.id} />
                            <ConfirmSubmit
                              label={t("discard")}
                              confirmLabel={t("confirmDiscard")}
                              cancelLabel={t("cancel")}
                              pendingLabel={t("working")}
                            />
                          </form>
                        </span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!isSuperadmin && dead.length > 0 ? <p className="muted small">{t("superadminOnly")}</p> : null}
      </section>

      <section className="section">
        <div className="section-head">
          <div>
            <h2>{t("sweepsTitle")}</h2>
          </div>
          <span className="muted small">{t("sweepsLead")}</span>
        </div>
        {sweeps.length === 0 ? (
          <p className="muted">{t("sweepsNone")}</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">{t("colSweep")}</th>
                  <th scope="col">{t("colWhen")}</th>
                  <th scope="col">{t("colVia")}</th>
                  <th scope="col">{t("colDuration")}</th>
                  <th scope="col">{t("colResult")}</th>
                </tr>
              </thead>
              <tbody>
                {sweeps.map((s) => (
                  <tr key={s.id}>
                    <td data-label={t("colSweep")}>
                      <code>{s.name}</code>
                    </td>
                    <td data-label={t("colWhen")}>{when.format(s.startedAt)}</td>
                    <td data-label={t("colVia")}>{s.via === "cron" ? t("viaCron") : t("viaTimer")}</td>
                    <td data-label={t("colDuration")}>
                      {Math.max(0, Math.round((s.finishedAt.getTime() - s.startedAt.getTime()) / 100) / 10)} s
                    </td>
                    <td data-label={t("colResult")}>
                      <span className={s.ok ? "badge badge-success" : "badge badge-danger"}>
                        {s.ok ? t("ok") : t("failed")}
                      </span>{" "}
                      <span className="muted small">{s.summary}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="section">
        <div className="section-head">
          <div>
            <h2>{t("recentTitle")}</h2>
          </div>
        </div>
        {recent.length === 0 ? (
          <p className="muted">{t("recentNone")}</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">{t("colKind")}</th>
                  <th scope="col">{t("colStatus")}</th>
                  <th scope="col">{t("colAttempts")}</th>
                  <th scope="col">{t("colCreated")}</th>
                  <th scope="col">{t("colRunAt")}</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((j) => (
                  <tr key={j.id}>
                    <td data-label={t("colKind")}>
                      <code>{j.kind}</code>
                    </td>
                    <td data-label={t("colStatus")}>{t(`status.${j.status}`)}</td>
                    <td data-label={t("colAttempts")}>
                      {j.attempts} / {j.maxAttempts}
                    </td>
                    <td data-label={t("colCreated")}>{when.format(j.createdAt)}</td>
                    <td data-label={t("colRunAt")}>{j.status === "PENDING" ? when.format(j.runAt) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
