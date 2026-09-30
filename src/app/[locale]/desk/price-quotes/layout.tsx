import type { ReactNode } from "react";
import { pageTitleMetadata } from "@/lib/page-title";

// Metadata only: gives this section its document title (see @/lib/page-title).
export const generateMetadata = pageTitleMetadata("deskPriceQuotes");

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
