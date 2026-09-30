import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getWorkspace } from "@/lib/workspace";
import { getTranslations } from "next-intl/server";
import { intlLocale } from "@/lib/money";
import { restoreList } from "@/app/list-actions";
import { ListsTable } from "./_components/ListsTable";
import { JoinedNotice } from "@/app/joined-notice";
import { ViewOnlyNote } from "@/components/view-only-note";

export const dynamic = "force-dynamic";

// How many archived lists the "Archived" section offers to restore. Older
// ones stay in the DB (and in the audit trail); this is an undo shelf, not
// an archive browser.
const ARCHIVED_SHOWN = 20;

export default async function ListsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  const joined = sp.joined === "1";
  const justArchivedId = typeof sp.archived === "string" ? sp.archived : null;
  const t = await getTranslations({ locale, namespace: "lists" });
  const session = await auth();
  const ws = await getWorkspace(session?.user?.id);
  const orgId = ws?.activeOrgId ?? null;
  // A view-only seat sees the org's plans but can't rename, duplicate,
  // archive or restore them (lib/scope canEditOnOrg refuses those actions).
  const readOnly = !!orgId && !ws?.activeCanEdit;
  const [lists, archived] = orgId
    ? await Promise.all([
        prisma.savedList.findMany({
          where: { organizationId: orgId, archivedAt: null },
          orderBy: { updatedAt: "desc" },
          select: {
            id: true,
            name: true,
            updatedAt: true,
            // Placements and recommended alternatives are counted apart: an
            // alternatives-only plan has nothing to send (lib/lists.ts).
            _count: { select: { items: { where: { isAlternative: false } } } },
            items: { where: { isAlternative: true }, select: { id: true } },
            requests: { select: { createdAt: true }, orderBy: { createdAt: "desc" }, take: 1 },
          },
        }),
        prisma.savedList.findMany({
          where: { organizationId: orgId, archivedAt: { not: null } },
          orderBy: { archivedAt: "desc" },
          take: ARCHIVED_SHOWN,
          select: {
            id: true,
            name: true,
            archivedAt: true,
            _count: { select: { items: { where: { isAlternative: false } } } },
          },
        }),
      ])
    : [[], []];
  // Only an archive in the viewer's own org earns the undo banner — the id
  // comes from the URL.
  const justArchived = justArchivedId ? archived.find((l) => l.id === justArchivedId) ?? null : null;
  const dateFmt = new Intl.DateTimeFormat(intlLocale(locale), { day: "numeric", month: "short", year: "numeric" });

  return (
    <>
      {joined ? <JoinedNotice locale={locale} organizationId={orgId} variant="lists" /> : null}
      {readOnly ? <ViewOnlyNote locale={locale} /> : null}
      {justArchived && !readOnly ? (
        <div className="banner-info" role="status">
          <span>{t("archivedNotice", { name: justArchived.name })}</span>
          <form action={restoreList}>
            <input type="hidden" name="listId" value={justArchived.id} />
            <input type="hidden" name="locale" value={locale} />
            <button type="submit" className="btn small secondary">
              {t("undo")}
            </button>
          </form>
        </div>
      ) : null}
      <ListsTable locale={locale} lists={lists} heading={t("title")} emptyLabel={t("empty")} readOnly={readOnly} />
      {archived.length > 0 ? (
        <details className="lists-archived">
          <summary>{t("archivedHeading", { count: archived.length })}</summary>
          <ul className="lists-archived__list">
            {archived.map((l) => (
              <li key={l.id} className="lists-archived__row">
                <span>
                  <strong>{l.name}</strong>{" "}
                  <span className="muted small">
                    {t("placementCount", { count: l._count.items })} ·{" "}
                    {t("archivedOn", { date: dateFmt.format(l.archivedAt!) })}
                  </span>
                </span>
                {readOnly ? null : (
                  <form action={restoreList}>
                    <input type="hidden" name="listId" value={l.id} />
                    <input type="hidden" name="locale" value={locale} />
                    <button type="submit" className="link">
                      {t("restore")}
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </>
  );
}
