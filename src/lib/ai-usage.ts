// Spend guard and usage log for LLM calls.
//
// Every gateway call goes through `withAiBudget`: it first checks the
// caller's daily budget and the global one (both counted in the database,
// so they hold across app instances and restarts), then runs the call and
// records feature, scope, outcome and latency in AiCallLog. Over budget —
// or if the budget cannot be checked at all — the call is NOT made and the
// caller gets null, which every AI path already treats as "use the
// deterministic result". Failing closed here means a database problem can
// degrade a recommendation, never run up an unbounded model bill.

import { prisma } from "@/lib/prisma";
import { log } from "@/lib/log";
import { aiDailyBudgets, type AiFeature } from "@/lib/ai-config";

// "org:<id>" | "user:<id>" | "anon". Anonymous traffic shares one scope: it
// is additionally rate-limited per IP at the route.
export type AiScope = string;

export function aiScope(who: { organizationId?: string | null; userId?: string | null } | null | undefined): AiScope {
  if (who?.organizationId) return `org:${who.organizationId}`;
  if (who?.userId) return `user:${who.userId}`;
  return "anon";
}

export type BudgetVerdict = "ok" | "budget_scope" | "budget_global";

// Pure: the rule itself. Refused calls are not counted against the budget.
export function budgetVerdict(
  used: { scope: number; global: number },
  budgets: { perScope: number; global: number },
): BudgetVerdict {
  if (used.global >= budgets.global) return "budget_global";
  if (used.scope >= budgets.perScope) return "budget_scope";
  return "ok";
}

const COUNTED = ["ok", "failed", "timeout"];

function dayStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

async function record(row: { feature: string; model: string; scope: string; outcome: string; ms: number }) {
  try {
    await prisma.aiCallLog.create({ data: row });
  } catch (err) {
    log.warn("ai.usage_log_failed", { feature: row.feature, err });
  }
}

export async function withAiBudget<T>(
  meta: { feature: AiFeature; model: string; scope: AiScope },
  call: () => Promise<{ value: T | null; outcome: "ok" | "failed" | "timeout" }>,
  now: Date = new Date(),
): Promise<T | null> {
  let verdict: BudgetVerdict;
  try {
    const since = dayStart(now);
    const [scopeUsed, globalUsed] = await Promise.all([
      prisma.aiCallLog.count({
        where: { scope: meta.scope, createdAt: { gte: since }, outcome: { in: COUNTED } },
      }),
      prisma.aiCallLog.count({ where: { createdAt: { gte: since }, outcome: { in: COUNTED } } }),
    ]);
    verdict = budgetVerdict({ scope: scopeUsed, global: globalUsed }, aiDailyBudgets());
  } catch (err) {
    // Cannot tell whether we are over budget: do not spend.
    log.warn("ai.budget_check_failed", { feature: meta.feature, err });
    return null;
  }
  if (verdict !== "ok") {
    log.warn("ai.budget_exceeded", { feature: meta.feature, scope: meta.scope, verdict });
    await record({ ...meta, outcome: verdict, ms: 0 });
    return null;
  }

  const started = Date.now();
  let result: { value: T | null; outcome: "ok" | "failed" | "timeout" };
  try {
    result = await call();
  } catch (err) {
    log.warn("ai.call_threw", { feature: meta.feature, err });
    result = { value: null, outcome: "failed" };
  }
  const ms = Date.now() - started;
  log.info("ai.call", { feature: meta.feature, model: meta.model, scope: meta.scope, outcome: result.outcome, ms });
  await record({ ...meta, outcome: result.outcome, ms });
  return result.value;
}

export { TtlCache } from "@/lib/ai-usage-cache";
