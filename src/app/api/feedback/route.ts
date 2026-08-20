import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";

const GETPLATFORM_URL =
  process.env.GETPLATFORM_URL || "https://get-platform-production.up.railway.app";
const GETPLATFORM_API_KEY = process.env.GETPLATFORM_API_KEY;

export async function POST(req: NextRequest) {
  try {
    const { message, category, pageUrl: bodyPageUrl } = await req.json();
    if (typeof message !== "string" || !message.trim()) {
      return NextResponse.json({ error: "Message is required" }, { status: 400 });
    }
    const normalizedCategory = category === "bug" ? "bug" : "feedback";
    const pageUrl = bodyPageUrl || req.headers.get("referer") || undefined;

    if (!GETPLATFORM_API_KEY) {
      console.error(
        "[feedback] GETPLATFORM_API_KEY is not configured — submission NOT delivered to GetPlatform",
      );
      return NextResponse.json({ error: "Feedback service is not configured" }, { status: 503 });
    }

    const session = await auth();

    const response = await fetch(`${GETPLATFORM_URL}/api/feedback`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": GETPLATFORM_API_KEY,
      },
      body: JSON.stringify({
        message: message.trim(),
        category: normalizedCategory,
        platform: "nativespin",
        pageUrl,
        userEmail: session?.user?.email ?? undefined,
        userId: session?.user?.id ?? undefined,
        userName: session?.user?.name ?? undefined,
        userContext: session?.user
          ? { role: session.user.role ?? null }
          : undefined,
      }),
    });

    if (!response.ok) {
      console.error("[feedback] GetPlatform relay failed", await response.text());
      return NextResponse.json({ error: "Failed to send feedback" }, { status: 500 });
    }

    const data = await response.json();
    return NextResponse.json({ success: true, id: data.id });
  } catch (error) {
    console.error("[feedback] error", error);
    return NextResponse.json({ error: "Failed to send feedback" }, { status: 500 });
  }
}
