import type { ReactNode } from "react";

type Props = {
  eyebrow?: ReactNode;
  title: ReactNode;
  lead?: ReactNode;
  children?: ReactNode;
};

// Editorial page header used at the top of every server-rendered page.
// Pair with <Breadcrumb> when the route is a detail view.
export function PageHeader({ eyebrow, title, lead, children }: Props) {
  return (
    <header className="page-header">
      {eyebrow ? <span className="eyebrow accent">{eyebrow}</span> : null}
      <h1>{title}</h1>
      {lead ? <p className="lead">{lead}</p> : null}
      {children}
    </header>
  );
}
