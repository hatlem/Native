import { getTranslations } from "next-intl/server";

export type PlaybookCardData = {
  title: string;
  angle: string | null;
  structure: string | null;
  doList: string | null;
  dontList: string | null;
  exampleHeadlines: string | null;
};

function lines(value: string | null): string[] {
  return (value ?? "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

// The matched content playbook for a placement. Shared by the desk order
// page and the writer's line page — the playbook page promises it "surfaces
// to the writer on every brief", so both must render the same guidance.
export async function PlaybookCard({
  locale,
  playbook,
}: {
  locale: string;
  playbook: PlaybookCardData;
}) {
  const t = await getTranslations({ locale, namespace: "playbooks" });
  const dos = lines(playbook.doList);
  const donts = lines(playbook.dontList);
  const headlines = lines(playbook.exampleHeadlines);
  return (
    <div className="card playbook-card" style={{ marginTop: 0 }}>
      <span className="eyebrow accent">{t("matchedEyebrow")}</span>
      <h4 style={{ margin: "0.25rem 0" }}>{playbook.title}</h4>
      {playbook.angle ? (
        <p className="small">
          <strong>{t("angle")}:</strong> {playbook.angle}
        </p>
      ) : null}
      {playbook.structure ? (
        <p className="small">
          <strong>{t("structure")}:</strong> {playbook.structure}
        </p>
      ) : null}
      {dos.length > 0 || donts.length > 0 ? (
        <div className="grid two">
          {dos.length > 0 ? (
            <div>
              <p className="small muted">{t("doList")}</p>
              <ul className="small">
                {dos.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {donts.length > 0 ? (
            <div>
              <p className="small muted">{t("dontList")}</p>
              <ul className="small">
                {donts.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
      {headlines.length > 0 ? (
        <details>
          <summary className="small">{t("exampleHeadlines")}</summary>
          <ul className="small">
            {headlines.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
