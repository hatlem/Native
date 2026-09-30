import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { formatMoney } from "@/lib/money";
import { lineOrder } from "@/lib/commerce/line-order";

// The buyer's view of extra work on their order: hours agreed on the quote
// and hours the desk added after acceptance (OrderExtraWork), each with its
// description and hours × rate, and whether it is already invoiced. Loads
// its own rows so the order page only has to place it. Renders nothing when
// there is none.
export async function OrderExtraWorkSection({
  locale,
  orderId,
  quoteId,
  currency,
}: {
  locale: string;
  orderId: string;
  quoteId: string;
  currency: string;
}) {
  const [quoteLines, entries] = await Promise.all([
    prisma.quoteLine.findMany({
      where: { quoteId, kind: "EXTRA_WORK" },
      orderBy: lineOrder(),
      select: { id: true, description: true, hours: true, hourlyRate: true, lineTotal: true },
    }),
    prisma.orderExtraWork.findMany({
      where: { orderId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true, description: true, hours: true, hourlyRate: true, lineTotal: true, invoiceId: true },
    }),
  ]);
  if (quoteLines.length === 0 && entries.length === 0) return null;

  const t = await getTranslations({ locale, namespace: "extraWork" });
  const tScope = await getTranslations({ locale, namespace: "articleScope" });
  const money = (n: unknown) => formatMoney(Number(n), currency, locale);
  const detail = (hours: unknown, rate: unknown) =>
    tScope("extraWorkDetail", { hours: Number(hours), rate: money(rate) });

  return (
    <section className="section" id="extra-work">
      <div className="section-head">
        <div>
          <h2>{t("buyerHeading")}</h2>
          <p className="muted small">{t("buyerLead")}</p>
        </div>
      </div>
      <article className="quote-card">
        <div className="quote-lines">
          {quoteLines.map((l) => (
            <div className="quote-line" key={l.id}>
              <span>
                {l.description} <span className="muted">· {detail(l.hours, l.hourlyRate)}</span>
              </span>
              <span className="num">{money(l.lineTotal)}</span>
            </div>
          ))}
          {entries.map((e) => (
            <div className="quote-line" key={e.id}>
              <span>
                {e.description} <span className="muted">· {detail(e.hours, e.hourlyRate)}</span>{" "}
                <span className="tag">{e.invoiceId ? t("invoiced") : t("toBeInvoiced")}</span>
              </span>
              <span className="num">{money(e.lineTotal)}</span>
            </div>
          ))}
        </div>
      </article>
    </section>
  );
}
