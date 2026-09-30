// The names a notice about an order carries: the buyer's plan name (what the
// buyer called the campaign, see plan-name.ts) and the buying org's name. One
// query shape for every sender, so no notice falls back to a bare "Order
// in production" because its caller didn't have the plan at hand.

import { prisma } from "@/lib/prisma";

export type OrderNoticeContext = {
  organizationId: string;
  orgName: string;
  planName: string;
};

export async function orderNoticeContext(orderId: string): Promise<OrderNoticeContext> {
  const order = await prisma.order.findUniqueOrThrow({
    where: { id: orderId },
    select: {
      organizationId: true,
      organization: { select: { name: true } },
      quote: { select: { request: { select: { plan: { select: { name: true } } } } } },
    },
  });
  return {
    organizationId: order.organizationId,
    orgName: order.organization.name,
    planName: order.quote.request.plan.name,
  };
}
