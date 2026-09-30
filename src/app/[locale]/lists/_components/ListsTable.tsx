import { getTranslations } from "next-intl/server";
import { EmptyState } from "@/app/empty-state";
import { intlLocale } from "@/lib/money";
import {
  renameList,
  duplicateList,
  archiveList,
} from "@/app/list-actions";

type ListRow = {
  id: string;
  name: string;
  updatedAt: Date;
  // Committed lines only; alternatives come separately.
  _count: { items: number };
  items: { id: string }[];
  requests: { createdAt: Date }[];
};

type Props = {
  locale: string;
  lists: ListRow[];
  heading: string;
  emptyLabel: string;
  // View-only (RESTRICTED) seat: names are shown as text and only "Open" is
  // offered — no rename, duplicate or archive (the server refuses them anyway).
  readOnly?: boolean;
};

export async function ListsTable({ locale, lists, heading, emptyLabel, readOnly = false }: Props) {
  const t = await getTranslations({ locale, namespace: "lists" });
  const dateFmt = new Intl.DateTimeFormat(intlLocale(locale), {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  return (
    <>
      <header className="page-header">
        <h1>{heading}</h1>
      </header>

      {lists.length === 0 ? (
        // A way forward, not just a sentence: plans start in the catalog.
        <EmptyState
          title={emptyLabel}
          primaryHref="/catalog"
          primaryLabel={t("emptyCta")}
          secondaryHref="/plan"
          secondaryLabel={t("emptySecondaryCta")}
        />
      ) : (
        <div className="table-wrap responsive">
          <table className="table">
            <thead>
              <tr>
                <th>{t("name")}</th>
                <th className="num">{t("items")}</th>
                <th>{t("lastSubmittedHeading")}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {lists.map((list) => {
                const lastSubmitted = list.requests[0]?.createdAt ?? null;
                return (
                  <tr key={list.id}>
                    <td data-label={t("name")}>
                      {readOnly ? (
                        <strong>{list.name}</strong>
                      ) : (
                      <form action={renameList} className="cluster tight">
                        <input type="hidden" name="listId" value={list.id} />
                        <input type="hidden" name="locale" value={locale} />
                        <input
                          type="text"
                          name="name"
                          defaultValue={list.name}
                          aria-label={t("rename")}
                          className="input"
                        />
                        <button type="submit" className="link">
                          {t("rename")}
                        </button>
                      </form>
                      )}
                    </td>
                    <td data-label={t("items")} className="num">
                      {t("placementCount", { count: list._count.items })}
                      {list.items.length > 0 ? (
                        <div className="muted small">{t("alternativeCount", { count: list.items.length })}</div>
                      ) : null}
                    </td>
                    <td data-label={t("lastSubmittedHeading")}>
                      {lastSubmitted
                        ? t("lastSubmitted", { date: dateFmt.format(lastSubmitted) })
                        : t("neverSubmitted")}
                    </td>
                    <td className="actions-col">
                      <div className="cluster tight">
                        {/* A plain link to the plan's own address — opens in a new
                            tab, can be copied. Full navigation, not <Link>: opening
                            another plan detours through the /plan/open route
                            handler (it makes the plan active), which a client-side
                            RSC fetch can't follow. */}
                        <a href={`/${locale}/plan/${list.id}`} className="link">
                          {t("open")}
                        </a>
                        {readOnly ? null : (
                        <>
                        <form action={duplicateList}>
                          <input type="hidden" name="listId" value={list.id} />
                          <input type="hidden" name="locale" value={locale} />
                          <button type="submit" className="link">
                            {t("duplicate")}
                          </button>
                        </form>
                        <form action={archiveList}>
                          <input type="hidden" name="listId" value={list.id} />
                          <input type="hidden" name="locale" value={locale} />
                          <button type="submit" className="link">
                            {t("archive")}
                          </button>
                        </form>
                        </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
