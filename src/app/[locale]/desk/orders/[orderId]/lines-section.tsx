import { getTranslations } from "next-intl/server";
import type { Playbook, Prisma } from "@prisma/client";
import { formatMoney } from "@/lib/money";
import {
  saveLineDraft,
  runSpecCheck,
  setAssetStatus,
} from "@/app/desk-content-actions";
import { assignWriterToLine } from "@/app/writer-pool-actions";
import { writerStaffableLine } from "@/lib/authorship";
import { StatusBadge } from "@/app/status-badge";
import { pickPlaybook } from "@/lib/playbook";
import { PlaybookCard } from "@/components/playbook-card";
import { SubmitButton } from "@/components";
import { nextAssetStatuses } from "@/lib/content/versions";
import { lineBrief } from "@/lib/writers/line-brief";

type ProductWithTitle = Prisma.ProductGetPayload<{
  include: { title: true };
}>;

// Mirrors the `matchablePlaybooks` mapping built in page.tsx.
type MatchablePlaybook = Omit<Playbook, "productType" | "marketCode"> & {
  productType: string | null;
  marketCode: string | null;
};

type OrderForLines = Prisma.OrderGetPayload<{
  include: {
    quote: true;
    lines: {
      include: {
        brief: true;
        articlePlacement: {
          include: { article: { include: { versions: { orderBy: { version: "desc" } } } } };
        };
        trackedLinks: true;
      };
    };
    writerPool: {
      select: {
        writerId: true;
        writer: { select: { user: { select: { name: true; email: true } } } };
      };
    };
  };
}>;

type Props = {
  locale: string;
  order: OrderForLines;
  byId: Map<string, ProductWithTitle>;
  matchablePlaybooks: MatchablePlaybook[];
  // The buyer's request brief (Request.briefSummary) — see lineBrief().
  requestBrief: string | null;
};

export async function LinesSection({
  locale,
  order,
  byId,
  matchablePlaybooks,
  requestBrief,
}: Props) {
  const t = await getTranslations({ locale, namespace: "order" });
  const tp = await getTranslations({ locale, namespace: "production" });
  const tType = await getTranslations({ locale, namespace: "productType" });
  const tw = await getTranslations({ locale, namespace: "deskWriters.panel" });

  return (
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
          const assets = line.articlePlacement?.article.versions ?? [];
          const latest = assets[0];
          // Placement lines carry a brief; content-fee lines never do.
          const brief = line.brief ? lineBrief(line.brief, requestBrief) : null;
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
                <form action={assignWriterToLine} className="cluster tight">
                  <input type="hidden" name="locale" value={locale} />
                  <input type="hidden" name="orderId" value={order.id} />
                  <input type="hidden" name="orderLineId" value={line.id} />
                  <label className="small" htmlFor={`writer-${line.id}`}>
                    {tw("writerLabel")}
                  </label>
                  <select
                    id={`writer-${line.id}`}
                    name="writerId"
                    defaultValue={line.assignedWriterId ?? ""}
                  >
                    <option value="">{tw("unassigned")}</option>
                    {order.writerPool.map((pool) => (
                      // `label`, not a text child: React SSR flattens <option>
                      // children into one text node, which Cloudflare's email
                      // obfuscation rewrites (breaking hydration). Attributes
                      // are left alone — see safe-email.tsx.
                      <option
                        key={pool.writerId}
                        value={pool.writerId}
                        label={pool.writer.user.name ?? pool.writer.user.email}
                      />

                    ))}
                  </select>
                  <SubmitButton
                    label={tw("assign")}
                    pendingLabel={tw("saving")}
                    className="btn small secondary"
                  />
                </form>
              ) : null}

              {pb ? <PlaybookCard locale={locale} playbook={pb} /> : null}

              {brief?.audience || brief?.message ? (
                <dl className="spec-grid">
                  {brief.audience ? (
                    <>
                      <dt>{tp("audience")}</dt>
                      <dd>{brief.audience}</dd>
                    </>
                  ) : null}
                  {brief.message ? (
                    <>
                      <dt>{tp("brief")}</dt>
                      <dd>{brief.message}</dd>
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
                            {/* The number the client and the notices use. */}
                            {a.reviewRound ? ` · ${tp("reviewRound", { round: a.reviewRound })}` : ""}
                          </span>
                          <StatusBadge value={a.status} />
                          {/* specPassed now lives on the placement, not the
                              asset version — it reflects "does the placement's
                              effective draft pass its spec", so the badge
                              belongs on the locked asset once locked, and
                              otherwise on the latest version. */}
                          {a.id === (line.articlePlacement?.lockedAssetId ?? latest?.id) && line.articlePlacement?.specPassed === true ? (
                            <span className="badge badge-success dotless">
                              ✓ {tp("specPass")}
                            </span>
                          ) : null}
                          {a.id === (line.articlePlacement?.lockedAssetId ?? latest?.id) && line.articlePlacement?.specPassed === false ? (
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

              {latest && !isContentFee && order.status !== "CANCELLED" ? (
                <div className="asset-actions">
                  <form action={runSpecCheck}>
                    <input type="hidden" name="locale" value={locale} />
                    <input
                      type="hidden"
                      name="placementId"
                      value={line.articlePlacement?.id ?? ""}
                    />
                    <button type="submit" className="btn small secondary">
                      {tp("specCheck")}
                    </button>
                  </form>
                  {/* Only the steps forward from the version's status
                      (versions.ts nextAssetStatuses): an approved article
                      offers "Finalize", not another review round. */}
                  {(
                    [
                      ["IN_REVIEW", tp("submitReview")],
                      ["APPROVED", tp("approve")],
                      ["FINAL", tp("finalize")],
                      ["CHANGES_REQUESTED", tp("requestChanges")],
                    ] as const
                  )
                    .filter(([target]) => nextAssetStatuses(latest.status).includes(target))
                    .map(([target, label]) => (
                    <form action={setAssetStatus} key={target}>
                      <input type="hidden" name="locale" value={locale} />
                      <input type="hidden" name="assetId" value={latest.id} />
                      <input type="hidden" name="target" value={target} />
                      <button type="submit" className="btn small ghost">
                        {label}
                      </button>
                    </form>
                  ))}
                </div>
              ) : null}

              {/* No editor where there is nothing to write: a CONTENT_FEE
                  line is billing-only, and a cancelled order is closed. */}
              {!isContentFee && order.status !== "CANCELLED" ? (
              <details className="spec-details">
                <summary>
                  {tp("draftLabel")}
                  <span className="muted small">{tp("composeNew")}</span>
                </summary>
                {/* Line-keyed, not article-keyed: the desk can compose the
                    first draft before a writer is staffed, so the action
                    creates the line's Article if it doesn't exist yet. */}
                <form action={saveLineDraft} className="product-form">
                  <input type="hidden" name="locale" value={locale} />
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
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}
