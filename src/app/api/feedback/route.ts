import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";

const GETPLATFORM_URL = process.env.GETPLATFORM_URL || "https://get-platform-production.up.railway.app";
// Scoped, low-privilege key: can only create feedback rows on GetPlatform,
// nothing else. Deliberately not the portfolio-wide GETPLATFORM_API_KEY.
const FEEDBACK_INGEST_KEY = process.env.FEEDBACK_INGEST_KEY;

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  if (!message) {
    return NextResponse.json({ error: "Message is required" }, { status: 400 });
  }
  const category = body?.category === "bug" ? "bug" : "feedback";
  const pageUrl =
    (typeof body?.pageUrl === "string" && body.pageUrl.trim()) || req.headers.get("referer") || undefined;

  if (!FEEDBACK_INGEST_KEY) {
    console.error("feedback.not_configured", "FEEDBACK_INGEST_KEY is not set — submission not delivered to GetPlatform");
    return NextResponse.json({ error: "Feedback service is not configured" }, { status: 503 });
  }

  try {
    const res = await fetch(`${GETPLATFORM_URL}/api/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": FEEDBACK_INGEST_KEY },
      body: JSON.stringify({
        message,
        category,
        platform: "nativespin",
        pageUrl,
        userEmail: session.user.email,
        userId: session.user.id,
        userName: session.user.name,
        userContext: {
          role: session.user.role,
          organizationId: session.user.orgId,
          organizationType: session.user.orgType,
        },
      }),
    });
    if (!res.ok) {
      console.error("feedback.upstream_failed", res.status, await res.text());
      return NextResponse.json({ error: "Failed to send feedback" }, { status: 502 });
    }
    const data = await res.json();
    return NextResponse.json({ success: true, id: data.id });
  } catch (error) {
    console.error("feedback.error", error);
    return NextResponse.json({ error: "Failed to send feedback" }, { status: 500 });
  }
}
