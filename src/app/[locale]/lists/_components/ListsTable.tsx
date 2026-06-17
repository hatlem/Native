import { getTranslations } from "next-intl/server";
import { intlLocale } from "@/lib/money";
import {
  renameList,
  duplicateList,
  archiveList,
  selectActiveList,
} from "@/app/list-actions";

type ListRow = {
  id: string;
  name: string;
  updatedAt: Date;
  _count: { items: number };
  requests: { createdAt: Date }[];
};

type Props = {
  locale: string;
  lists: ListRow[];
  heading: string;
  emptyLabel: string;
};

export async function ListsTable({ locale, lists, heading, emptyLabel }: Props) {
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
        <p className="lead muted">{emptyLabel}</p>
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
                    </td>
                    <td data-label={t("items")} className="num">
                      {t("itemCount", { count: list._count.items })}
                    </td>
                    <td data-label={t("lastSubmittedHeading")}>
                      {lastSubmitted
                        ? t("lastSubmitted", { date: dateFmt.format(lastSubmitted) })
                        : t("neverSubmitted")}
                    </td>
                    <td className="actions-col">
                      <div className="cluster tight">
                        <form action={selectActiveList}>
                          <input type="hidden" name="listId" value={list.id} />
                          <input type="hidden" name="locale" value={locale} />
                          <button type="submit" className="link">
                            {t("open")}
                          </button>
                        </form>
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
