import { prisma } from "@/lib/prisma";
import { isAssignmentActive } from "./access";
import type { WriterForMatch } from "./match";

export type RosterWriter = WriterForMatch & {
  id: string;
  userId: string;
  name: string | null;
  email: string;
  ratePerArticle: number | null;
  currency: string | null;
};

// All writer profiles with languages, specialties, and a live count of
// active assignments (assigned lines whose latest asset isn't FINAL/
// RETRACTED). Used by the desk Writers panel for match ranking.
export async function loadRoster(): Promise<RosterWriter[]> {
  const writers = await prisma.writerProfile.findMany({
    include: {
      user: { select: { name: true, email: true } },
      languages: { select: { language: true, proficiency: true } },
      specialties: { select: { topic: true } },
      assignedLines: {
        select: {
          brief: {
            select: {
              assets: {
                orderBy: { version: "desc" },
                take: 1,
                select: { status: true },
              },
            },
          },
        },
      },
    },
  });

  return writers.map((w) => {
    const activeAssignments = w.assignedLines.filter((line) =>
      isAssignmentActive(line.brief?.assets[0]?.status ?? null),
    ).length;
    return {
      id: w.id,
      userId: w.userId,
      name: w.user.name,
      email: w.user.email,
      active: w.active,
      maxActiveAssignments: w.maxActiveAssignments,
      activeAssignments,
      ratePerArticle: w.ratePerArticle != null ? Number(w.ratePerArticle) : null,
      currency: w.currency,
      languages: w.languages,
      specialties: w.specialties,
    };
  });
}
