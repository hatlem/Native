import { NextRequest, NextResponse } from "next/server";
import { appUrl } from "@/lib/url";
import { confirmSubscriber } from "@/lib/newsletter/store";

export async function GET(req: NextRequest) {
  const origin = appUrl();
  const token = req.nextUrl.searchParams.get("token");
  if (!token) return NextResponse.redirect(`${origin}/en/newsletter?status=invalid`);
  const res = await confirmSubscriber(token);
  if (!res) return NextResponse.redirect(`${origin}/en/newsletter?status=invalid`);
  return NextResponse.redirect(`${origin}/${res.locale}/newsletter?status=confirmed`);
}
