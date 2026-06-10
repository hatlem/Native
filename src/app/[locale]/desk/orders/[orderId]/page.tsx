import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { Link } from "@/i18n/navigation";
import { formatMoney } from "@/lib/money";
import { advanceOrder, cancelOrder } from "@/app/desk-actions";
import {
  saveDraft,
  runSpecCheck,
  setAssetStatus,
  confirmTrackedLinks,
} from "@/app/desk-content-actions";
import { issueInvoice, issueCreditNote } from "@/app/desk-billing-actions";
import { assignWriterToLine } from "@/app/writer-pool-actions";
import { writerStaffableLine } from "@/lib/authorship";
import { WritersPanel } from "./writers-panel";
import { extractLinks } from "@/lib/metrics/links";
import { StatusBadge } from "@/app/status-badge";
import { canCancelOrder, cancelBlockReason } from "@/lib/cancellation";
import { pickPlaybook } from "@/lib/playbook";
import { SubmitButton } from "@/components";
import { clicksByOrderLine } from "@/lib/metrics/store";
import { CampaignSection } from "./campaign-section";

export const dynamic = "force-dynamic";

const NON_ADVANCEABLE = ["COMPLETED", "INVOICED", "CANCELLED"];

export default async function DeskOrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; orderId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, orderId } = await params;
  const sp = await searchParams;
  const cancelError = typeof sp.cancel === "string" ? sp.cancel : undefined;
  const t = await getTranslations({ locale, namespace: "order" });
  const tp = await getTranslations({ locale, namespace: "production" });
  const tType = await getTranslations({ locale, namespace: "productType" });
  const td = await getTranslations({ locale, namespace: "desk" });
  const tt = await getTranslations({ locale, namespace: "performance" });

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      organization: true,
      quote: true,
      invoices: true,
      creditNotes: true,
      lines: {
        include: {
          brief: { include: { assets: { orderBy: { version: "desc" } } } },
          trackedLinks: true,
          booking: {
            include: {
              metrics: true,
              publisher: { select: { name: true } },
              title: { select: { name: true } },
            },
          },
        },
      },
      writerPool: {
        select: {
          writerId: true,
          writer: {
            select: { user: { select: { name: true, email: true } } },
          },
        },
      },
    },
  });
  if (!order) notFound();

  const metricsRequests = await prisma.metricsRequest.findMany({
    where: { orderId: order.id },
    select: {
      id: true,
      publisherId: true,
      status: true,
      recipientEmail: true,
      sentCount: true,
      token: true,
    },
  });
  const clicks = await clicksByOrderLine(order.lines.map((l) => l.id));

  const products = await prisma.product.findMany({
    where: {
      id: {
        in: order.lines
          .map((l) => l.productId)
          .filter((id): id is string => !!id),
      },
    },
    include: { title: true },
  });
  const byId = new Map(products.map((p) => [p.id, p]));
  const invoice = order.invoices[0];

  // Derive criteria from the first line that has a product/title.
  const firstProductLine = order.lines.find(
    (l) => l.productId != null && byId.has(l.productId),
  );
  const firstProduct = firstProductLine?.productId
    ? byId.get(firstProductLine.productId)
    : undefined;
  const firstLineCountry = firstProduct?.title.countryCode ?? "";
  const firstLineCategory = firstProduct?.title.category ?? "";

  // Phase-4 playbooks: load active playbooks once and match per placement
  // line so the writer sees the relevant guidance inline.
  const playbooks = await prisma.playbook.findMany({ where: { active: true } });
  const matchablePlaybooks = playbooks.map((p) => ({
    ...p,
    productType: p.productType as string | null,
    marketCode: p.marketCode as string | null,
  }));
  const tpb = await getTranslations({ locale, namespace: "playbooks" });

  return (
    <>
      <nav className="breadcrumb">
        <Link href="/desk/orders" className="small-link">
          ← {t("orders")}
        </Link>
      </nav>

      <header className="detail-head">
        <div>
          <span className="eyebrow accent">{td("eyebrow")}</span>
          <h1>
            {t("title")} · {order.organization.name}
          </h1>
          <p className="lead">{t("deskDetailLead")}</p>
        </div>
        <aside className="detail-meta">
          <div className="meta-row">
            <span className="muted small">{t("status")}</span>
            <span className="value">
              <StatusBadge value={order.status} />
            </span>
          </div>
          <div className="meta-row">
            <span className="muted small">{t("total")}</span>
            <span className="value">
              {formatMoney(
                Number(order.quote.total),
                order.quote.currency,
                locale,
              )}
            </span>
          </div>
          <div className="detail-actions">
            {!NON_ADVANCEABLE.includes(order.status) ? (
              <form action={advanceOrder}>
                <input type="hidden" name="locale" value={locale} />
                <input type="hidden" name="orderId" value={order.id} />
                <SubmitButton
                  label={t("advance")}
                  pendingLabel={t("advancing")}
                  className="btn block"
                />
              </form>
            ) : null}
            {order.status === "COMPLETED" && !invoice ? (
              <form action={issueInvoice}>
                <input type="hidden" name="locale" value={locale} />
                <input type="hidden" name="orderId" value={order.id} />
                <SubmitButton
                  label={t("issueInvoice")}
                  pendingLabel={t("issuingInvoice")}
                  className="btn block"
                />
              </form>
            ) : null}
            {invoice ? (
              <Link
                className="btn secondary block"
                href={`/invoices/${invoice.id}`}
              >
                {t("viewInvoice")}
              </Link>
            ) : null}
            {canCancelOrder(order.status) ? (
              <details className="spec-details">
                <summary>
                  <span className="btn secondary block">
                    {t("cancelButton")}
                  </span>
                </summary>
                <form action={cancelOrder} className="product-form">
                  <input type="hidden" name="locale" value={locale} />
                  <input type="hidden" name="orderId" value={order.id} />
                  <h4 style={{ margin: "12px 0 4px" }}>{t("cancelTitle")}</h4>
                  <p className="muted small">{t("cancelHint")}</p>
                  <div className="field">
                    <label htmlFor={`cancel-reason-${order.id}`}>
                      {t("cancelReasonLabel")}
                    </label>
                    <textarea
                      id={`cancel-reason-${order.id}`}
                      name="reason"
                      rows={4}
                      required
                      placeholder={t("cancelReasonPlaceholder")}
                    />
                  </div>
                  <div className="actions">
                    <SubmitButton
                      label={t("cancelSubmit")}
                      pendingLabel={t("cancelling")}
                      className="btn block"
                    />
                  </div>
                </form>
              </details>
            ) : order.status !== "CANCELLED" ? (
              <p className="muted small">
                {t("cancelBlocked")} {cancelBlockReason(order.status)}
              </p>
            ) : null}
          </div>
        </aside>
      </header>

      {cancelError ? (
        <div className="banner-error" role="alert">
          <strong>{t("cancelError")}:</strong> {cancelError}
        </div>
      ) : null}

      {order.status === "CANCELLED" && order.cancelledAt ? (
        <section className="cancelled-summary">
          <h2>{t("cancelledAtLabel")}</h2>
          <dl className="spec-grid">
            <dt>{t("cancelledAtLabel")}</dt>
            <dd>{order.cancelledAt.toISOString().slice(0, 16).replace("T", " ")}</dd>
            {order.cancelledBy ? (
              <>
                <dt>{t("cancelledByLabel")}</dt>
                <dd>{order.cancelledBy}</dd>
              </>
            ) : null}
            {order.cancelReason ? (
              <>
                <dt>{t("cancelledReasonLabel")}</dt>
                <dd>{order.cancelReason}</dd>
              </>
            ) : null}
          </dl>

          {/* Credit-note affordance — only renders once invoice exists,
              order is CANCELLED, and no credit note has been issued. */}
          {invoice &&
          ["ISSUED", "PAID", "OVERDUE"].includes(invoice.status) &&
          order.creditNotes.length === 0 ? (
            <details className="spec-details">
              <summary>
                <span className="btn secondary">{t("creditNoteButton")}</span>
              </summary>
              <form action={issueCreditNote} className="product-form">
                <input type="hidden" name="locale" value={locale} />
                <input type="hidden" name="orderId" value={order.id} />
                <h4 style={{ margin: "12px 0 4px" }}>{t("creditNoteTitle")}</h4>
                <p className="muted small">
                  {t("creditNoteHint", {
                    amount: formatMoney(
                      Number(invoice.total),
                      invoice.currency,
                      locale,
                    ),
                  })}
                </p>
                <div className="field">
                  <label htmlFor={`credit-reason-${order.id}`}>
                    {t("creditNoteReasonLabel")}
                  </label>
                  <textarea
                    id={`credit-reason-${order.id}`}
                    name="reason"
                    rows={3}
                    required
                    placeholder={t("creditNoteReasonPlaceholder")}
                  />
                </div>
                <div className="actions">
                  <SubmitButton
                    label={t("creditNoteSubmit")}
                    pendingLabel={t("issuingCreditNote")}
                    className="btn"
                  />
                </div>
              </form>
            </details>
          ) : order.creditNotes.length > 0 ? (
            <p className="muted small">
              <strong>{t("creditNoteIssuedLabel")}:</strong>{" "}
              {formatMoney(
                Number(order.creditNotes[0].amount),
                order.creditNotes[0].currency,
                locale,
              )}{" "}
              · {order.creditNotes[0].reason}
            </p>
          ) : null}
        </section>
      ) : null}

      {["CONFIRMED", "IN_PRODUCTION", "SCHEDULED", "LIVE", "COMPLETED"].includes(order.status) ? (
        <WritersPanel
          locale={locale}
          orderId={order.id}
          poolWriterIds={order.writerPool.map((p) => p.writerId)}
          criteriaCountry={firstLineCountry}
          criteriaCategory={firstLineCategory}
        />
      ) : null}

      <section className="section">
        <div className="section-head">
          <div>
            <span className="eyebrow">{t("productionEyebrow")}</span>
            <h2>{t("lines")}</h2>
          </div>
        </div>

        <div className="stack-4">
          {order.lines.map((line) => {
            const p = line.productId ? byId.get(line.productId) : undefined;
            const isContentFee = line.kind === "CONTENT_FEE";
            const assets = line.brief?.assets ?? [];
            const latest = assets[0];
            const pb = p
              ? pickPlaybook(
                  matchablePlaybooks,
                  p.type,
                  p.title.category,
                  p.title.countryCode,
                )
              : null;
            return (
              <article className="card desk-line-card" key={line.id}>
                <div className="line-head">
                  <div>
                    <h3>
                      {p?.title.name ??
                        (isContentFee ? tType("CONTENT_FEE") : "—")}
                    </h3>
                    <p className="muted small">{p ? tType(p.type) : ""}</p>
                  </div>
                  <div className="price" style={{ marginTop: 0 }}>
                    {formatMoney(
                      Number(line.lineTotal),
                      order.quote.currency,
                      locale,
                    )}
                  </div>
                </div>

                {order.writerPool.length > 0 && writerStaffableLine(line) ? (
                  <form action={assignWriterToLine} className="flex items-center gap-2">
                    <input type="hidden" name="locale" value={locale} />
                    <input type="hidden" name="orderId" value={order.id} />
                    <input type="hidden" name="orderLineId" value={line.id} />
                    <select
                      name="writerId"
                      defaultValue={line.assignedWriterId ?? ""}
                      className="text-xs border rounded px-1 py-0.5"
                    >
                      <option value="">— Unassigned —</option>
                      {order.writerPool.map((pool) => (
                        <option key={pool.writerId} value={pool.writerId}>
                          {pool.writer.user.name ?? pool.writer.user.email}
                        </option>
                      ))}
                    </select>
                    <button type="submit" className="ml-2 text-xs underline">
                      Assign
                    </button>
                  </form>
                ) : null}

                {pb ? (
                  <div className="card playbook-card" style={{ marginTop: 0 }}>
                    <span className="eyebrow accent">{tpb("matchedEyebrow")}</span>
                    <h4 style={{ margin: "0.25rem 0" }}>{pb.title}</h4>
                    {pb.angle ? (
                      <p className="small">
                        <strong>{tpb("angle")}:</strong> {pb.angle}
                      </p>
                    ) : null}
                    {pb.structure ? (
                      <p className="small">
                        <strong>{tpb("structure")}:</strong> {pb.structure}
                      </p>
                    ) : null}
                    <div className="grid two">
                      {pb.doList ? (
                        <div>
                          <p className="small muted">{tpb("doList")}</p>
                          <ul className="small">
                            {pb.doList
                              .split("\n")
                              .filter((s) => s.trim())
                              .map((s, i) => (
                                <li key={i}>{s.trim()}</li>
                              ))}
                          </ul>
                        </div>
                      ) : null}
                      {pb.dontList ? (
                        <div>
                          <p className="small muted">{tpb("dontList")}</p>
                          <ul className="small">
                            {pb.dontList
                              .split("\n")
                              .filter((s) => s.trim())
                              .map((s, i) => (
                                <li key={i}>{s.trim()}</li>
                              ))}
                          </ul>
                        </div>
                      ) : null}
                    </div>
                    {pb.exampleHeadlines ? (
                      <details>
                        <summary className="small">{tpb("exampleHeadlines")}</summary>
                        <ul className="small">
                          {pb.exampleHeadlines
                            .split("\n")
                            .filter((s) => s.trim())
                            .map((s, i) => (
                              <li key={i}>{s.trim()}</li>
                            ))}
                        </ul>
                      </details>
                    ) : null}
                  </div>
                ) : null}

                {line.brief?.audience || line.brief?.message ? (
                  <dl className="spec-grid">
                    {line.brief.audience ? (
                      <>
                        <dt>{tp("audience")}</dt>
                        <dd>{line.brief.audience}</dd>
                      </>
                    ) : null}
                    {line.brief.message ? (
                      <>
                        <dt>{tp("brief")}</dt>
                        <dd>{line.brief.message}</dd>
                      </>
                    ) : null}
                  </dl>
                ) : null}

                <div className="asset-timeline">
                  <h4>{tp("history")}</h4>
                  {assets.length === 0 ? (
                    <p className="muted small">{tp("noAssets")}</p>
                  ) : (
                    <ul className="timeline-list">
                      {assets.map((a) => (
                        <li key={a.id} className="timeline-item">
                          <div className="timeline-head">
                            <span className="timeline-label">
                              {tp("version")} {a.version}
                            </span>
                            <StatusBadge value={a.status} />
                            {a.specPassed === true ? (
                              <span className="badge badge-success dotless">
                                ✓ {tp("specPass")}
                              </span>
                            ) : null}
                            {a.specPassed === false ? (
                              <span className="badge badge-warning dotless">
                                ⚠ {tp("specFail")}
                              </span>
                            ) : null}
                          </div>
                          {a.reviewNotes ? (
                            <p className="muted small">{a.reviewNotes}</p>
                          ) : null}
                          {a.body ? (
                            <pre className="asset-body">
                              {a.body.slice(0, 240)}
                              {a.body.length > 240 ? "…" : ""}
                            </pre>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {latest ? (
                  <div className="asset-actions">
                    <form action={runSpecCheck}>
                      <input type="hidden" name="locale" value={locale} />
                      <input type="hidden" name="orderId" value={order.id} />
                      <input type="hidden" name="assetId" value={latest.id} />
                      <button type="submit" className="btn small secondary">
                        {tp("specCheck")}
                      </button>
                    </form>
                    {(
                      [
                        ["IN_REVIEW", tp("submitReview")],
                        ["APPROVED", tp("approve")],
                        ["FINAL", tp("finalize")],
                        ["CHANGES_REQUESTED", tp("requestChanges")],
                      ] as const
                    ).map(([target, label]) => (
                      <form action={setAssetStatus} key={target}>
                        <input type="hidden" name="locale" value={locale} />
                        <input type="hidden" name="orderId" value={order.id} />
                        <input type="hidden" name="assetId" value={latest.id} />
                        <input type="hidden" name="target" value={target} />
                        <button type="submit" className="btn small ghost">
                          {label}
                        </button>
                      </form>
                    ))}
                  </div>
                ) : null}

                <details className="spec-details">
                  <summary>
                    {tp("draftLabel")}
                    <span className="muted small">{tp("composeNew")}</span>
                  </summary>
                  <form action={saveDraft} className="product-form">
                    <input type="hidden" name="locale" value={locale} />
                    <input type="hidden" name="orderId" value={order.id} />
                    <input type="hidden" name="orderLineId" value={line.id} />
                    <div className="field">
                      <label htmlFor={`body-${line.id}`}>
                        {tp("draftLabel")}
                      </label>
                      <textarea
                        id={`body-${line.id}`}
                        name="body"
                        rows={6}
                        placeholder={tp("draftPlaceholder")}
                      />
                    </div>
                    <div className="actions">
                      <button type="submit" className="btn small">
                        {tp("saveDraft")}
                      </button>
                    </div>
                  </form>
                </details>
              </article>
            );
          })}
        </div>
      </section>

      <CampaignSection
        locale={locale}
        order={order}
        metricsRequests={metricsRequests}
        clicks={clicks}
      />
    </>
  );
}
