import { NextRequest, NextResponse } from "next/server";
import { appUrl } from "@/lib/url";
import { unsubscribeSubscriber } from "@/lib/newsletter/store";
import { prisma } from "@/lib/prisma";
import { hashToken } from "@/lib/tokens";

export async function GET(req: NextRequest) {
  const origin = appUrl();
  const token = req.nextUrl.searchParams.get("token");
  if (!token) return NextResponse.redirect(`${origin}/en/newsletter?status=invalid`);

  // Try the durable unsub token first; fall back to a pre-confirmation
  // confirm token (which also identifies the row) so the opt-out link in a
  // not-yet-confirmed email still works.
  let res = await unsubscribeSubscriber(token);
  if (!res) {
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
  if (!res) return NextResponse.redirect(`${origin}/en/newsletter?status=invalid`);
  return NextResponse.redirect(`${origin}/${res.locale}/newsletter?status=unsubscribed`);
}
