// Saving the extra-work hourly rates (ExtraWorkRate): the DB half of the
// /desk/content-fees action, kept out of the "use server" file so the role
// rule and the validation are exercised without a session
// (extra-work.it.test.ts).
//
// SUPERADMIN only: the rate is published to every buyer wherever the article
// fee is explained, so a desk seat bills hours against it but can't change
// it. The whole form is validated before anything is written, so one bad
// value saves nothing; only the currencies whose rate actually changed are
// written, and the change is audited with its before/after figures.

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { currencyCodeSchema, hourlyRateSchema } from "@/lib/pricing/extra-work";

const ratesSchema = z
  .array(z.object({ currency: currencyCodeSchema, hourlyRate: hourlyRateSchema }))
  .min(1)
  .max(20)
  .refine((rows) => new Set(rows.map((r) => r.currency)).size === rows.length, "duplicate currency");

export type SaveExtraWorkRatesResult =
  | { outcome: "forbidden" }
  | { outcome: "invalid" }
  | { outcome: "saved"; changed: { currency: string; from: number | null; to: number }[] };

export async function saveExtraWorkRates(input: {
  actor: { userId: string | null | undefined; role: string | null | undefined };
  // The raw form values: currency code → typed rate ("1 650", "140,50").
  rates: { currency: string; hourlyRate: string }[];
}): Promise<SaveExtraWorkRatesResult> {
  if (input.actor.role !== "SUPERADMIN" || !input.actor.userId) return { outcome: "forbidden" };
  const parsed = ratesSchema.safeParse(input.rates);
  if (!parsed.success) return { outcome: "invalid" };

  const before = new Map(
    (await prisma.extraWorkRate.findMany()).map((r) => [r.currency, Number(r.hourlyRate)]),
  );
  const changed = parsed.data
    .filter((r) => before.get(r.currency) !== r.hourlyRate)
    .map((r) => ({ currency: r.currency, from: before.get(r.currency) ?? null, to: r.hourlyRate }));
  if (changed.length === 0) return { outcome: "saved", changed };

  await prisma.$transaction(
    changed.map((r) =>
      prisma.extraWorkRate.upsert({
        where: { currency: r.currency },
        create: { currency: r.currency, hourlyRate: r.to },
        update: { hourlyRate: r.to },
      }),
    ),
  );
  await recordAudit(input.actor.userId, "extraWorkRate.update", "ExtraWorkRate:*", { changes: changed });
  return { outcome: "saved", changed };
}
