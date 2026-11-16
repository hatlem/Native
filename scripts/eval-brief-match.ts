// Golden-set eval for the brief → facets extraction.
//
//   pnpm tsx scripts/eval-brief-match.ts            # LLM extraction only
//   pnpm tsx scripts/eval-brief-match.ts --merged   # deterministic + LLM, as production merges them
//
// Run it before changing the prompt in src/lib/brief-match-llm.ts or the
// model in AI_MODEL_BRIEF_MATCH: it exits non-zero when the pass rate drops
// below the threshold in scripts/eval-data/brief-match-golden.json.
//
// Needs GETPLATFORM_AI_KEY (the calls are real and are counted against the
// daily AI budget) and a database for that budget, so it is run by hand,
// not in CI. The scoring rule itself is unit-tested (src/lib/ai-eval.test.ts).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { enrichBriefWithLLM, llmEnrichmentAvailable } from "@/lib/brief-match-llm";
import { extractFacets, mergeFacets } from "@/lib/brief-match";
import { evalSummary, scoreEvalCase, type EvalCase } from "@/lib/ai-eval";
import { aiModel } from "@/lib/ai-config";
import { prisma } from "@/lib/prisma";

async function main() {
  if (!llmEnrichmentAvailable()) {
    console.error("GETPLATFORM_AI_KEY is not set — nothing to evaluate.");
    process.exit(2);
  }
  const merged = process.argv.includes("--merged");
  const file = JSON.parse(
    readFileSync(join(process.cwd(), "scripts/eval-data/brief-match-golden.json"), "utf8"),
  ) as { passThreshold: number; cases: EvalCase[] };

  console.log(`model=${aiModel("brief-match")} mode=${merged ? "merged" : "llm-only"} cases=${file.cases.length}`);
  const results = [];
  for (const c of file.cases) {
    const started = Date.now();
    const llm = await enrichBriefWithLLM(c.brief, "user:eval");
    const got = merged ? mergeFacets(extractFacets(c.brief), llm) : llm;
    const r = scoreEvalCase(c, got);
    results.push(r);
    const ms = Date.now() - started;
    console.log(
      `${r.pass ? "PASS" : "FAIL"} ${c.id} (${ms}ms)` +
        (r.missing.length ? ` missing=[${r.missing.join(", ")}]` : "") +
        (r.unexpected.length ? ` unexpected=[${r.unexpected.join(", ")}]` : ""),
    );
  }
  const summary = evalSummary(results);
  console.log(`\n${summary.passed}/${summary.total} passed (${Math.round(summary.rate * 100)}%), threshold ${Math.round(file.passThreshold * 100)}%`);
  if (summary.rate < file.passThreshold) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
