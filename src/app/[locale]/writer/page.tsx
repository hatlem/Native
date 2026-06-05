import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export default async function WriterHome({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const session = await auth();
  const role = session?.user?.role;
  if (
    !session?.user ||
    (role !== "CONTENT" && role !== "DESK" && role !== "SUPERADMIN")
  ) {
    redirect(`/${locale}/signin`);
  }

  const profile = await prisma.writerProfile.findUnique({
    where: { userId: session.user.id },
    select: { id: true },
  });

  const lines = profile
    ? await prisma.orderLine.findMany({
        where: { assignedWriterId: profile.id },
        select: {
          id: true,
          productId: true,
          brief: {
            select: {
              message: true,
              assets: {
                orderBy: { version: "desc" },
                take: 1,
                select: { status: true },
              },
            },
          },
          order: { select: { id: true } },
        },
        orderBy: { assignedAt: "desc" },
      })
    : [];

  // Resolve products separately (OrderLine has no direct product relation)
  const productIds = lines
    .map((l) => l.productId)
    .filter((id): id is string => !!id);
  const products =
    productIds.length > 0
      ? await prisma.product.findMany({
          where: { id: { in: productIds } },
          select: {
            id: true,
            name: true,
            title: { select: { name: true, countryCode: true } },
          },
        })
      : [];
  const productById = new Map(products.map((p) => [p.id, p]));

  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="text-lg font-semibold">My assignments</h1>
      {lines.length === 0 ? (
        <p className="mt-4 text-sm text-neutral-500">
          No assignments yet. The desk will assign you articles here.
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-neutral-100">
          {lines.map((line) => {
            const product = line.productId
              ? productById.get(line.productId)
              : undefined;
            return (
              <li key={line.id} className="py-3">
                <Link
                  href={`/${locale}/writer/lines/${line.id}`}
                  className="font-medium underline"
                >
                  {product?.title.name ?? "Article"} — {product?.name}
                </Link>
                <div className="text-xs text-neutral-500">
                  {product?.title.countryCode} ·{" "}
                  {line.brief?.assets[0]?.status ?? "NOT STARTED"}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
