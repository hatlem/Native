import { getTranslations } from "next-intl/server";
import { loadRoster } from "@/lib/writers/roster";
import { rankWriters } from "@/lib/writers/match";
import { languageForCountry, topicForCategory } from "@/lib/writers/criteria";
import {
  addWriterToPool,
  removeWriterFromPool,
} from "@/app/writer-pool-actions";
import type { ContentLanguage, ContentTopic } from "@prisma/client";
import { SafeEmail } from "@/components/safe-email";
import { SubmitButton } from "@/components";

type Props = {
  locale: string;
  orderId: string;
  poolWriterIds: string[];
  // Derived from the order's lines' titles (country code + category).
  criteriaCountry: string;
  criteriaCategory: string;
};

export async function WritersPanel({
  locale,
  orderId,
  poolWriterIds,
  criteriaCountry,
  criteriaCategory,
}: Props) {
  const t = await getTranslations({ locale, namespace: "deskWriters.panel" });
  const tEnum = await getTranslations({ locale, namespace: "writerEnums" });
  const roster = await loadRoster();
  const language: ContentLanguage | null = languageForCountry(criteriaCountry);
  const topics: ContentTopic[] = [topicForCategory(criteriaCategory)];
  const ranked = rankWriters(roster, { language, topics });

  return (
    <section className="section">
      <div className="section-head">
        <div>
          <span className="eyebrow">{t("eyebrow")}</span>
          <h2>{t("title")}</h2>
          <p className="muted small">
            {t("lead", {
              language: language ? tEnum(`language.${language}`) : "—",
              topics: topics.map((topic) => tEnum(`topic.${topic}`)).join(", "),
            })}
          </p>
        </div>
      </div>

      {ranked.length === 0 ? (
        <p className="muted">{t("empty")}</p>
      ) : (
        <div className="table-wrap responsive">
          <table className="table">
            <thead>
              <tr>
                <th>{t("colWriter")}</th>
                <th>{t("colLanguages")}</th>
                <th>{t("colSpecialties")}</th>
                <th>{t("colLoad")}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {ranked.map((w) => {
                const inPool = poolWriterIds.includes(w.id);
                return (
                  <tr key={w.id}>
                    <td data-label={t("colWriter")}>
                      <strong>{w.name ?? <SafeEmail address={w.email} />}</strong>
                      <div className="cluster tight" style={{ marginTop: 4 }}>
                        {inPool ? (
                          <span className="badge badge-info dotless">{t("inPool")}</span>
                        ) : null}
                        {!w.active ? (
                          <span className="badge badge-neutral dotless">{t("inactive")}</span>
                        ) : null}
                        {w.match.overCapacity ? (
                          <span className="badge badge-warning dotless">{t("overCapacity")}</span>
                        ) : null}
                      </div>
                    </td>
                    <td data-label={t("colLanguages")}>
                      {w.languages.length > 0
                        ? w.languages
                            .map((l) =>
                              l.proficiency
                                ? `${tEnum(`language.${l.language}`)} (${tEnum(`proficiency.${l.proficiency}`)})`
                                : tEnum(`language.${l.language}`),
                            )
                            .join(", ")
                        : <span className="muted">{t("none")}</span>}
                    </td>
                    <td data-label={t("colSpecialties")}>
                      {w.specialties.length > 0
                        ? w.specialties.map((s) => tEnum(`topic.${s.topic}`)).join(", ")
                        : <span className="muted">{t("none")}</span>}
                    </td>
                    <td className="num" data-label={t("colLoad")}>
                      {w.maxActiveAssignments != null
                        ? t("loadOf", { active: w.activeAssignments, max: w.maxActiveAssignments })
                        : t("load", { active: w.activeAssignments })}
                    </td>
                    <td className="actions-col">
                      <form action={inPool ? removeWriterFromPool : addWriterToPool}>
                        <input type="hidden" name="locale" value={locale} />
                        <input type="hidden" name="orderId" value={orderId} />
                        <input type="hidden" name="writerId" value={w.id} />
                        <SubmitButton
                          label={inPool ? t("remove") : t("add")}
                          pendingLabel={t("saving")}
                          className={inPool ? "btn small ghost" : "btn small secondary"}
                        />
                      </form>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
