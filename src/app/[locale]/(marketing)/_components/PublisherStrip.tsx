import { getTranslations } from "next-intl/server";
import { getStripPublishers } from "@/lib/marketing/strip-publishers";

export async function PublisherStrip({ locale }: { locale: string }) {
  const [t, publishers] = await Promise.all([
    getTranslations({ locale, namespace: "landing" }),
    getStripPublishers(),
  ]);
  if (publishers.length === 0) return null;

  return (
    <section className="pub-strip" aria-label={t("pubs.stripLabel")}>
      <div className="wrap">
        <div className="pub-strip-label">{t("pubs.stripLabel")}</div>
        <ul className="pub-strip-row" role="list">
          {publishers.map((p) => (
            <li key={p.id} role="listitem">
              {p.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.logoUrl} alt={p.name} className="pub-strip-logo" />
              ) : (
                <span className="pub-strip-chip">{p.name}</span>
              )}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
