import type { ReactNode } from "react";

type Props = {
  eyebrow?: ReactNode;
  title: ReactNode;
  lead?: ReactNode;
  meta: ReactNode;
};

// Two-column detail header: title block on the left, sticky meta panel
// on the right. Stacks at 760px. Use <MetaRow> for each row in meta.
export function DetailHead({ eyebrow, title, lead, meta }: Props) {
  return (
    <header className="detail-head">
      <div>
        {eyebrow ? <span className="eyebrow accent">{eyebrow}</span> : null}
        <h1>{title}</h1>
        {lead ? <p className="lead">{lead}</p> : null}
      </div>
      <aside className="detail-meta">{meta}</aside>
    </header>
  );
}

export function MetaRow({
  label,
  children,
}: {
  label: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="meta-row">
      <span className="muted small">{label}</span>
      <span className="value">{children}</span>
    </div>
  );
}
