import { prisma } from "@/lib/prisma";

// Distinct Title.vertical values in active use — shared between the
// catalog's "Who reads it?" filter and the plan's targeting picker so both
// surfaces offer exactly the same, real vocabulary.
export async function loadVerticalOptions(): Promise<string[]> {
  const rows = await prisma.title.findMany({
    where: { active: true, vertical: { not: null } },
    select: { vertical: true },
    distinct: ["vertical"],
    orderBy: { vertical: "asc" },
  });
  return rows.map((r) => r.vertical!).filter((v) => v.trim().length > 0);
}
