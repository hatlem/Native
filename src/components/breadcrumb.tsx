import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

type Props = {
  href: string;
  children: ReactNode;
};

// Single-level back breadcrumb used above detail-head on detail pages.
// Renders nothing if href is empty (defensive in case a parent passes
// the wrong thing).
export function Breadcrumb({ href, children }: Props) {
  const ta11y = useTranslations("common.a11y");
  if (!href) return null;
  return (
    <nav className="breadcrumb" aria-label={ta11y("breadcrumb")}>
      <Link href={href} className="small-link">
        ← {children}
      </Link>
    </nav>
  );
}
