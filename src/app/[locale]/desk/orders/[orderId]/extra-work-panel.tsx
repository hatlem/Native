import { getTranslations } from "next-intl/server";
import type { OrderStatus, InvoiceStatus } from "@prisma/client";
import { formatMoney } from "@/lib/money";
import { ExtraWorkForm, SubmitButton } from "@/components";
import { extraWorkBlock } from "@/lib/order-lifecycle";
import { extraWorkHourlyRate, type ExtraWorkRateSpec } from "@/lib/pricing/extra-work";
import { addOrderExtraWorkAction, removeOrderExtraWorkAction } from "@/app/desk-billing-actions";

type Entry = {
  id: string;
  description: string;
  hours: unknown;
  hourlyRate: unknown;
  lineTotal: unknown;
  invoiceId: string | null;
};

// ?extraWork= codes from desk-billing-actions → extraWork message keys.
const ERROR_KEYS: Readonly<Record<string, string>> = {
  invalid: "errorInvalid",
  "no-rate": "errorNoRate",
  locked: "errorLocked",
};

// The desk's extra work on an order: the hours agreed on the quote (read
// only — the accepted quote is immutable) and the hours added since, which
// go onto the invoice when it is issued. Adding and removing stop once the
// invoice exists (order-lifecycle.ts extraWorkBlock).
export async function ExtraWorkPanel({
  locale,
  order,
  entries,
  quoteLines,
  rates,
  errorCode,
}: {
  locale: string;
  order: { id: string; status: OrderStatus; currency: string; invoices: { id: string; status: InvoiceStatus }[] };
  entries: Entry[];
  // EXTRA_WORK lines of the accepted quote.
  quoteLines: { id: string; description: string; hours: unknown; hourlyRate: unknown; lineTotal: unknown }[];
  rates: readonly ExtraWorkRateSpec[];
  errorCode: string | undefined;
}) {
  const t = await getTranslations({ locale, namespace: "extraWork" });
  const tScope = await getTranslations({ locale, namespace: "articleScope" });
  const block = extraWorkBlock(order.status, order.invoices);
  const rate = extraWorkHourlyRate(rates, order.currency);
  const money = (n: unknown) => formatMoney(Number(n), order.currency, locale);
  const detail = (hours: unknown, hourlyRate: unknown) =>
    tScope("extraWorkDetail", { hours: Number(hours), rate: money(hourlyRate) });
  const errorKey = errorCode ? ERROR_KEYS[errorCode] : undefined;

  // Nothing billed and nothing billable: a cancelled order with no hours
  // needs no panel.
  if (block === "closed" && entries.length === 0 && quoteLines.length === 0) return null;

  return (
    <section className="section" id="extra-work">
      <div className="section-head">
        <h2>{t("heading")}</h2>
      </div>
      <div className="card stack-4">
        {quoteLines.length + entries.length > 0 ? (
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
                <span className="cluster tight">
                  <span className="num">{money(e.lineTotal)}</span>
                  {!e.invoiceId && !block ? (
                    <form action={removeOrderExtraWorkAction}>
                      <input type="hidden" name="locale" value={locale} />
                      <input type="hidden" name="orderId" value={order.id} />
                      <input type="hidden" name="entryId" value={e.id} />
                      <SubmitButton label={t("remove")} pendingLabel={t("removing")} className="btn small ghost" />
                    </form>
                  ) : null}
                </span>
              </div>
            ))}
          </div>
        ) : null}
        {block === "invoiced" ? (
          <p className="muted small">{t("orderLocked")}</p>
        ) : block === "closed" ? (
          <p className="muted small">{t("orderClosed")}</p>
        ) : (
          <ExtraWorkForm
            action={addOrderExtraWorkAction}
            hidden={{ locale, orderId: order.id }}
            lead={
              rate === null ? null : t("orderLead", { rate: formatMoney(rate, order.currency, locale), currency: order.currency })
            }
            noRate={t("noRate", { currency: order.currency })}
            error={errorKey ? t(errorKey) : null}
            labels={{
              heading: t("add"),
              hours: t("hoursLabel"),
              hoursHint: t("hoursHint"),
              description: t("descriptionLabel"),
              descriptionPlaceholder: t("descriptionPlaceholder"),
              add: t("add"),
              adding: t("adding"),
            }}
          />
        )}
      </div>
    </section>
  );
}
