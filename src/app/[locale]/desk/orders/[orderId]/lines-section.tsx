import { getTranslations } from "next-intl/server";
import type { Playbook, Prisma } from "@prisma/client";
import { formatMoney } from "@/lib/money";
import {
  saveDraft,
  runSpecCheck,
  setAssetStatus,
} from "@/app/desk-content-actions";
import { assignWriterToLine } from "@/app/writer-pool-actions";
import { writerStaffableLine } from "@/lib/authorship";
import { StatusBadge } from "@/app/status-badge";
import { pickPlaybook } from "@/lib/playbook";

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
        brief: { include: { assets: { orderBy: { version: "desc" } } } };
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
};

export async function LinesSection({
  locale,
  order,
  byId,
  matchablePlaybooks,
}: Props) {
  const t = await getTranslations({ locale, namespace: "order" });
  const tp = await getTranslations({ locale, namespace: "production" });
  const tType = await getTranslations({ locale, namespace: "productType" });
  const tpb = await getTranslations({ locale, namespace: "playbooks" });

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
  );
}
