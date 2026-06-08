import { NextResponse, type NextRequest } from "next/server";
import { previewLimiter } from "@/lib/rate-limit";
import { parsePreviewInput } from "@/lib/preview/schema";
import { resolvePreview } from "@/lib/preview/resolve";
import { generatePreviewArticle, generationAvailable } from "@/lib/preview/generate";

export const dynamic = "force-dynamic";

function clientIp(req: NextRequest | Request): string {
  const h = req.headers;
  return (
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    h.get("x-real-ip") ||
    "unknown"
  );
}

// POST /api/preview-ad — generate a sample native-ad article for the public
// preview tool. Always returns 200 with an article (AI when available + under
// limit, otherwise a deterministic template).
export async function POST(req: NextRequest | Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = parsePreviewInput(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const ip = clientIp(req);
  const rate = await previewLimiter.check(`preview:${ip}`);

  const result = await resolvePreview({
    input: parsed.value,
    hasKey: generationAvailable(),
    rateOk: rate.ok,
    runClaude: (input) => generatePreviewArticle(input),
  });

  // Only expose what the client needs. `reason` (no_key/rate_limited/ai_error)
  // stays server-side so the public endpoint doesn't reveal whether the Claude
  // integration is wired up.
  return NextResponse.json(
    { source: result.source, article: result.article },
    { headers: { "Cache-Control": "no-store" } },
  );
}
