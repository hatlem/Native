import type { ReactNode } from "react";
import { Link } from "@/i18n/navigation";

type Props = {
  label: ReactNode;
  value: ReactNode;
  delta?: ReactNode;
  tone?: "neutral" | "warn";
  ctaHref?: string;
  ctaLabel?: ReactNode;
  // §5 — set on the dashboard's primary KPI so it spans two grid cells
  // and the value typography upsizes. Only one KPI per grid should
  // carry this flag.
  primary?: boolean;
};

// Single dashboard KPI tile. Wrap a row of them in <div className="kpi-grid">.
// When ctaHref + ctaLabel are passed, the tile renders a contextual link —
// per §4 we only render the CTA when there's a concrete next step (e.g. count > 0).
export function Kpi({
  label,
  value,
  delta,
  tone,
  ctaHref,
  ctaLabel,
  primary,
}: Props) {
  const classes = ["kpi"];
  if (tone === "warn") classes.push("kpi-warn");
  if (primary) classes.push("kpi-primary");
  return (
    <div className={classes.join(" ")}>
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {delta ? <div className="delta">{delta}</div> : null}
      {ctaHref && ctaLabel ? (
        <Link href={ctaHref} className="cta">
          {ctaLabel} →
        </Link>
      ) : null}
    </div>
  );
}

export function KpiGrid({ children }: { children: ReactNode }) {
  return <div className="kpi-grid">{children}</div>;
}
