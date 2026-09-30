import { NextRequest, NextResponse } from "next/server";
import { appUrl } from "@/lib/url";
import { unsubscribeSubscriber } from "@/lib/newsletter/store";
import { newsletterFallbackLocale } from "@/lib/newsletter/links";
import { prisma } from "@/lib/prisma";
import { hashToken } from "@/lib/tokens";

export async function GET(req: NextRequest) {
  const origin = appUrl();
  const token = req.nextUrl.searchParams.get("token");

  // The durable unsubscribe token (see @/lib/newsletter/links) first; then
  // a confirm token, which is what confirmation emails sent before the
  // durable token existed used for their opt-out link. confirmSubscriber
  // keeps that hash after confirming, so those links keep working too.
  let res = token ? await unsubscribeSubscriber(token) : null;
  if (!res && token) {
    const row = await prisma.subscriber.findUnique({
      where: { confirmTokenHash: hashToken(token) },
      select: { email: true, locale: true },
    });
    if (row) {
      await prisma.subscriber.update({
        where: { email: row.email },
        data: { status: "UNSUBSCRIBED", unsubscribedAt: new Date(), confirmTokenHash: null },
      });
      res = { locale: row.locale };
    }
  }
  if (!res) {
    const locale = newsletterFallbackLocale(
      req.nextUrl.searchParams.get("lang"),
      req.cookies.get("NEXT_LOCALE")?.value,
      req.headers.get("accept-language"),
    );
    return NextResponse.redirect(`${origin}/${locale}/newsletter?status=invalid`);
  }
  return NextResponse.redirect(`${origin}/${res.locale}/newsletter?status=unsubscribed`);
}
