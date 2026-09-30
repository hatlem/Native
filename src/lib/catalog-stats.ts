import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { catalogVisibleTitleWhere } from "@/lib/catalog-visibility";

// The ONE title count every public surface quotes — the home hero, its
// stats strip, the catalog gate, page titles. It counts exactly what a
// verified buyer can browse (catalogVisibleTitleWhere), so "N titles" is a
// promise the catalog keeps. Before this, the home page counted every row
// ever imported (discontinued ones included) while the catalog gate
// counted active titles only, and the page title hard-coded "3,000+":
// three numbers for one catalog.
export const catalogTitleCount = cache(
  (): Promise<number> => prisma.title.count({ where: catalogVisibleTitleWhere }),
);

// For "{n}+ titles" copy: round DOWN, so the "+" is always true and the
// figure doesn't churn with every import (2,814 → "2,800+").
export function titleCountFloor(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0;
  const step = n >= 1000 ? 100 : n >= 100 ? 10 : 1;
  return Math.floor(n / step) * step;
}
