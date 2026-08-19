import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { loadProgrammeForList } from "@/lib/programme";
import { intlLocale } from "@/lib/money";

// Read-only programme context for the desk: which wave this order is, what
// the other waves are doing, and each wave's article angle — so the desk can
// quote/produce THIS wave with the next one in view (and sell it proactively)
// instead of parsing "Article angle (wave 2 of 3)" out of the brief prose.
export async function ProgrammePanel({ locale, orderId }: { locale: string; orderId: string }) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { quote: { select: { request: { select: { sourceListId: true } } } } },
  });
  const listId = order?.quote.request.sourceListId;
  if (!listId) return null;
  const view = await loadProgrammeForList(listId);
  if (!view) return null;

  const t = await getTranslations({ locale, namespace: "desk.programme" });
  const dateFmt = new Intl.DateTimeFormat(intlLocale(locale), { day: "numeric", month: "short" });
  const current = view.waves.find((w) => w.listId === listId);

  return (
    <section className="desk-programme">
      <div className="desk-programme__head">
        <strong>
          {t("title", { name: view.name, n: current?.waveNumber ?? 0, of: view.plannedWaves })}
        </strong>
        <span className="muted small">{t("spacing", { weeks: view.spacingWeeks })}</span>
      </div>
      <ol className="desk-programme__waves">
        {view.waves.map((w) => (
          <li
            key={w.listId}
            className={`desk-programme__wave${w.listId === listId ? " is-current" : ""}`}
          >
            <span className="desk-programme__wave-num">{t("wave", { n: w.waveNumber })}</span>
            <span className={`badge dotless wave-strip__state wave-strip__state--${w.state}`}>
              {t(`state.${w.state}`)}
            </span>
            <span className="muted small">
              {w.scheduleStart ? dateFmt.format(w.scheduleStart) : t("noDate")}
            </span>
            {w.articleAngle ? (
              <span className="desk-programme__angle">{w.articleAngle}</span>
            ) : null}
            {w.listId === listId ? (
              <span className="desk-programme__this">{t("thisOrder")}</span>
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  );
}
