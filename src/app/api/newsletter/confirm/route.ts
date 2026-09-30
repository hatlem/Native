import { NextRequest, NextResponse } from "next/server";
import { appUrl } from "@/lib/url";
import { confirmSubscriber } from "@/lib/newsletter/store";
import { newsletterFallbackLocale } from "@/lib/newsletter/links";

export async function GET(req: NextRequest) {
  const origin = appUrl();
  const token = req.nextUrl.searchParams.get("token");
  const res = token ? await confirmSubscriber(token) : null;
  if (!res) {
    const locale = newsletterFallbackLocale(
      req.nextUrl.searchParams.get("lang"),
      req.cookies.get("NEXT_LOCALE")?.value,
    );
    return NextResponse.redirect(`${origin}/${locale}/newsletter?status=invalid`);
  }
  return NextResponse.redirect(`${origin}/${res.locale}/newsletter?status=confirmed`);
}
