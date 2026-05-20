import { Link } from "@/i18n/navigation";

export function EmptyState({
  title,
  hint,
  primaryHref,
  primaryLabel,
  secondaryHref,
  secondaryLabel,
}: {
  title: string;
  hint?: string;
  primaryHref?: string;
  primaryLabel?: string;
  secondaryHref?: string;
  secondaryLabel?: string;
}) {
  return (
    <div className="empty">
      <span className="empty-icon" aria-hidden="true">
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M3 7l9-4 9 4-9 4-9-4z" />
          <path d="M3 7v10l9 4 9-4V7" />
          <path d="M12 11v10" />
        </svg>
      </span>
      <p className="empty-title">{title}</p>
      {hint ? <p>{hint}</p> : null}
      {primaryHref || secondaryHref ? (
        <div className="empty-actions">
          {primaryHref ? (
            <Link href={primaryHref} className="btn">
              {primaryLabel}
            </Link>
          ) : null}
          {secondaryHref ? (
            <Link href={secondaryHref} className="btn secondary">
              {secondaryLabel}
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
