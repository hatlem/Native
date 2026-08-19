import { Prisma, type UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";

// The display title an Article gets when it is created for an existing
// placement: the placement's title (publication) name, falling back to a
// generic label when the line has no product (or the product is gone).
export async function articleTitleForLine(orderLineId: string): Promise<string> {
  const line = await prisma.orderLine.findUnique({
    where: { id: orderLineId },
    select: { productId: true },
  });
  const product = line?.productId
    ? await prisma.product.findUnique({
        where: { id: line.productId },
        select: { title: { select: { name: true } } },
      })
    : null;
  return product?.title.name ?? "Untitled article";
}

// Idempotently gets (or creates) the Article that owns a line's drafts.
// An OrderLine's Article can be born from either side — the desk staffing
// a writer, or the desk/a writer composing the first draft — so both call
// this rather than each running their own find-then-create.
//
// `assignedWriterId` is applied on update as well as create so a
// re-assignment repoints the existing Article; omit it entirely to leave
// an existing Article's writer untouched.
export async function ensureArticleForLine(args: {
  orderLineId: string;
  organizationId: string;
  title: string;
  createdByUserId: string;
  createdByRole: UserRole;
  assignedWriterId?: string | null;
}) {
  const { assignedWriterId, ...rest } = args;
  const update = assignedWriterId === undefined ? {} : { assignedWriterId };
  try {
    return await prisma.article.upsert({
      where: { orderLineId: args.orderLineId },
      update,
      create: { ...rest, assignedWriterId: assignedWriterId ?? null },
    });
  } catch (error) {
    // Prisma does not always compile upsert down to a single
    // INSERT … ON CONFLICT (it doesn't here — see the concurrency case in
    // article-library.it.test.ts), so two first-writes for the same line
    // can still collide on the unique orderLineId. The loser of that race
    // adopts the row the winner just created instead of failing.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return prisma.article.update({ where: { orderLineId: args.orderLineId }, data: update });
    }
    throw error;
  }
}
