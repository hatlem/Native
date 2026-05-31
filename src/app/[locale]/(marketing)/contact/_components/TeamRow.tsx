import { getTranslations } from "next-intl/server";
import { DESK_TEAM } from "../desk-team";

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

export async function TeamRow({ locale }: { locale: string }) {
  if (DESK_TEAM.length === 0) return null;
  const t = await getTranslations({ locale, namespace: "landing" });

  return (
    <section className="section team-section">
      <div className="wrap">
        <h2>{t("team.heading")}</h2>
        <p className="lead">{t("team.lead")}</p>
        <div className="grid team-grid">
          {DESK_TEAM.map((m) => (
            <article className="card team-card" key={m.name}>
              {m.photo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={m.photo} alt={m.name} className="team-photo" />
              ) : (
                <div className="team-avatar" aria-hidden="true">
                  {initials(m.name)}
                </div>
              )}
              <h3>{m.name}</h3>
              <p className="muted">{m.role}</p>
              <p className="team-links">
                {m.linkedin && (
                  <a href={m.linkedin} rel="noopener noreferrer" target="_blank">
                    LinkedIn
                  </a>
                )}
                {m.phone && <a href={`tel:${m.phone}`}>{m.phone}</a>}
              </p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
