import { type Article, type PreviewInput } from "./schema";
import { templateArticle } from "./templates";

export type PreviewSource = "ai" | "template";
export interface PreviewResult {
  source: PreviewSource;
  reason?: "no_key" | "rate_limited" | "ai_error";
  article: Article;
}

export async function resolvePreview(args: {
  input: PreviewInput;
  hasKey: boolean;
  rateOk: boolean;
  runClaude: (input: PreviewInput) => Promise<Article | null>;
}): Promise<PreviewResult> {
  const { input, hasKey, rateOk, runClaude } = args;
  const template = (reason: PreviewResult["reason"]): PreviewResult => ({
    source: "template",
    reason,
    article: templateArticle(input),
  });

  if (!hasKey) return template("no_key");
  if (!rateOk) return template("rate_limited");
  const ai = await runClaude(input);
  if (!ai) return template("ai_error");
  return { source: "ai", article: ai };
}
