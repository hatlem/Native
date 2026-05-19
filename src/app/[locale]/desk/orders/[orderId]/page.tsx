import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { Link } from "@/i18n/navigation";
import { formatMoney } from "@/lib/money";
import {
  advanceOrder,
  saveDraft,
  runSpecCheck,
  setAssetStatus,
  issueInvoice,
} from "@/app/desk-actions";

export const dynamic = "force-dynamic";

const NON_ADVANCEABLE = ["COMPLETED", "INVOICED", "CANCELLED"];

export default async function DeskOrderPage({
  params,
}: {
  params: Promise<{ locale: string; orderId: string }>;
}) {
  const { locale, orderId } = await params;
  const t = await getTranslations({ locale, namespace: "order" });
  const tp = await getTranslations({ locale, namespace: "production" });
  const tType = await getTranslations({ locale, namespace: "productType" });

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      organization: true,
      quote: true,
      invoices: true,
      lines: {
        include: {
          brief: { include: { assets: { orderBy: { version: "desc" } } } },
        },
      },
    },
  });
  if (!order) notFound();

  const products = await prisma.product.findMany({
    where: { id: { in: order.lines.map((l) => l.productId) } },
    include: { title: true },
  });
  const byId = new Map(products.map((p) => [p.id, p]));
  const invoice = order.invoices[0];

  return (
    <section>
      <p>
        <Link href="/desk/orders">← {t("orders")}</Link>
      </p>
      <h1>
        {t("title")} · {order.organization.name}
      </h1>
      <p className="muted">
        {t("status")}: <strong>{order.status}</strong>
      </p>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        {!NON_ADVANCEABLE.includes(order.status) ? (
          <form action={advanceOrder}>
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="orderId" value={order.id} />
            <button type="submit" className="btn" style={{ marginTop: 0 }}>
              {t("advance")}
            </button>
          </form>
        ) : null}
        {order.status === "COMPLETED" && !invoice ? (
          <form action={issueInvoice}>
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="orderId" value={order.id} />
            <button type="submit" className="btn" style={{ marginTop: 0 }}>
              {t("issueInvoice")}
            </button>
          </form>
        ) : null}
        {invoice ? (
          <Link className="btn" href={`/invoices/${invoice.id}`}>
            {t("viewInvoice")}
          </Link>
        ) : null}
      </div>

      <h2 style={{ marginTop: 24 }}>{t("lines")}</h2>
      {order.lines.map((line) => {
        const p = byId.get(line.productId);
        const assets = line.brief?.assets ?? [];
        const latest = assets[0];
        return (
          <div className="card" key={line.id} style={{ marginBottom: 16 }}>
            <h3>{p?.title.name ?? line.productId}</h3>
            <div className="muted">{p ? tType(p.type) : ""}</div>
            {line.brief?.audience ? (
              <div className="muted">
                {tp("audience")}: {line.brief.audience}
              </div>
            ) : null}
            {line.brief?.message ? (
              <div className="muted">
                {tp("brief")}: {line.brief.message}
              </div>
            ) : null}

            {assets.length === 0 ? (
              <p className="note">{tp("noAssets")}</p>
            ) : (
              assets.map((a) => (
                <div
                  key={a.id}
                  className="muted"
                  style={{ borderTop: "1px solid var(--border)", marginTop: 8, paddingTop: 8 }}
                >
                  {tp("version")} {a.version} — {tp("status")}: {a.status}
                  {a.specPassed === true ? ` · ✅ ${tp("specPass")}` : null}
                  {a.specPassed === false ? ` · ⚠ ${tp("specFail")}` : null}
                  {a.reviewNotes ? <div>{a.reviewNotes}</div> : null}
                  {a.body ? (
                    <div style={{ marginTop: 4, whiteSpace: "pre-wrap" }}>
                      {a.body.slice(0, 240)}
                      {a.body.length > 240 ? "…" : ""}
                    </div>
                  ) : null}
                </div>
              ))
            )}

            {latest ? (
              <div
                style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}
              >
                {(
                  [
                    ["runSpecCheck", runSpecCheck, tp("specCheck"), undefined],
                    ["IN_REVIEW", setAssetStatus, tp("submitReview"), "IN_REVIEW"],
                    ["APPROVED", setAssetStatus, tp("approve"), "APPROVED"],
                    ["FINAL", setAssetStatus, tp("finalize"), "FINAL"],
                    [
                      "CHANGES_REQUESTED",
                      setAssetStatus,
                      tp("requestChanges"),
                      "CHANGES_REQUESTED",
                    ],
                  ] as const
                ).map(([key, action, label, target]) => (
                  <form action={action} key={key}>
                    <input type="hidden" name="locale" value={locale} />
                    <input type="hidden" name="orderId" value={order.id} />
                    <input type="hidden" name="assetId" value={latest.id} />
                    {target ? (
                      <input type="hidden" name="target" value={target} />
                    ) : null}
                    <button type="submit">{label}</button>
                  </form>
                ))}
              </div>
            ) : null}

            <form action={saveDraft} style={{ marginTop: 12 }}>
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="orderId" value={order.id} />
              <input type="hidden" name="orderLineId" value={line.id} />
              <label className="muted" htmlFor={`body-${line.id}`}>
                {tp("draftLabel")}
              </label>
              <textarea
                id={`body-${line.id}`}
                name="body"
                rows={4}
                style={{
                  display: "block",
                  width: "100%",
                  marginTop: 4,
                  background: "var(--bg)",
                  color: "var(--text)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  padding: 8,
                }}
              />
              <button type="submit" style={{ marginTop: 8 }}>
                {tp("saveDraft")}
              </button>
            </form>

            <div className="muted" style={{ marginTop: 8 }}>
              {formatMoney(Number(line.lineTotal), order.quote.currency, locale)}
            </div>
          </div>
        );
      })}
    </section>
  );
}
