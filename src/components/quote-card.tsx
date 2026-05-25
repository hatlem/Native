import type { ReactNode } from "react";

// Renders a quote / invoice line block: top section is the per-line
// list, bottom section is the totals strip. Pass the accept/declined
// banner or CTA as `footer`.

type LineProps = {
  description: ReactNode;
  meta?: ReactNode;
  amount: ReactNode;
};

type Props = {
  lines: LineProps[];
  rows: { label: ReactNode; amount: ReactNode; isTotal?: boolean }[];
  footer?: ReactNode;
};

export function QuoteCard({ lines, rows, footer }: Props) {
  return (
    <article className="card quote-card">
      <div className="quote-lines">
        {lines.map((l, i) => (
          <div key={i} className="quote-line">
            <span>
              {l.description}
              {l.meta ? <span className="muted"> {l.meta}</span> : null}
            </span>
            <span className="num">{l.amount}</span>
          </div>
        ))}
      </div>
      <div className="quote-totals">
        {rows.map((r, i) => (
          <div
            key={i}
            className={`quote-row ${r.isTotal ? "total" : ""}`}
          >
            <span className={r.isTotal ? undefined : "muted"}>{r.label}</span>
            <span className="num">{r.amount}</span>
          </div>
        ))}
      </div>
      {footer}
    </article>
  );
}
