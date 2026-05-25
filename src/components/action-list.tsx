import type { ReactNode } from "react";
import { Link } from "@/i18n/navigation";

// Inbox-style list of actionable items used on dashboards (the desk
// inbox, requests list, notifications etc).

type ItemProps = {
  href?: string;
  badge?: ReactNode;
  title: ReactNode;
  sub?: ReactNode;
  trailing?: ReactNode;
  readState?: "read" | "unread";
};

export function ActionList({ children }: { children: ReactNode }) {
  return <div className="action-list">{children}</div>;
}

export function ActionListItem({
  href,
  badge,
  title,
  sub,
  trailing,
  readState,
}: ItemProps) {
  const className = `item ${readState === "read" ? "item-read" : ""}`;
  const body = (
    <>
      {badge}
      <div>
        <div className="title">{title}</div>
        {sub ? <div className="sub">{sub}</div> : null}
      </div>
      {trailing ?? (
        <span className="chev" aria-hidden>
          →
        </span>
      )}
    </>
  );

  if (href) {
    return (
      <Link href={href} className={className}>
        {body}
      </Link>
    );
  }
  return <div className={className}>{body}</div>;
}
