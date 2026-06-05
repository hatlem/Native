"use server";

import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { canAssignWriter } from "@/lib/writers/access";
import { writerStaffableLine } from "@/lib/authorship";

function field(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v.trim() : "";
}

async function requireDeskUser(locale: string): Promise<string> {
  const session = await auth();
  const role = session?.user?.role;
  if (!session?.user || (role !== "DESK" && role !== "SUPERADMIN")) {
    redirect(`/${locale}/signin`);
  }
  return session.user.id;
}

export async function addWriterToPool(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const orderId = field(formData, "orderId");
  const writerId = field(formData, "writerId");
  const userId = await requireDeskUser(locale);

  await prisma.orderWriterPool.upsert({
    where: { orderId_writerId: { orderId, writerId } },
    update: {},
    create: { orderId, writerId, addedById: userId },
  });
  await recordAudit(userId, "writer.pool_add", `Order:${orderId}`, { writerId });

  redirect(`/${locale}/desk/orders/${orderId}`);
}

export async function removeWriterFromPool(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const orderId = field(formData, "orderId");
  const writerId = field(formData, "writerId");
  const userId = await requireDeskUser(locale);

  // Clear any line assignments to this writer on this order, then drop the
  // pool row — atomically, so we never leave a line assigned to a writer
  // who is no longer in the pool.
  await prisma.$transaction([
    prisma.orderLine.updateMany({
      where: { orderId, assignedWriterId: writerId },
      data: { assignedWriterId: null, assignedAt: null, assignedById: null },
    }),
    prisma.orderWriterPool.deleteMany({ where: { orderId, writerId } }),
  ]);
  await recordAudit(userId, "writer.pool_remove", `Order:${orderId}`, { writerId });

  redirect(`/${locale}/desk/orders/${orderId}`);
}

export async function assignWriterToLine(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const orderId = field(formData, "orderId");
  const orderLineId = field(formData, "orderLineId");
  const writerId = field(formData, "writerId"); // "" → unassign
  const userId = await requireDeskUser(locale);

  if (writerId === "") {
    await prisma.orderLine.update({
      where: { id: orderLineId },
      data: { assignedWriterId: null, assignedAt: null, assignedById: null },
    });
    await recordAudit(userId, "line.unassign", `OrderLine:${orderLineId}`);
    redirect(`/${locale}/desk/orders/${orderId}`);
  }

  const pool = await prisma.orderWriterPool.findMany({
    where: { orderId },
    select: { writerId: true },
  });
  if (!canAssignWriter(pool.map((p) => p.writerId), writerId)) {
    // Reject out-of-pool assignment silently — UI only offers pool members.
    redirect(`/${locale}/desk/orders/${orderId}`);
  }

  // Only an INVENTORY placement NativeSpin produces may be staffed. A
  // buyer-/publisher-produced placement is written elsewhere, and a
  // CONTENT_FEE line is billing-only (no brief/booking) — assigning a writer
  // to either is a category error, so reject it even on a tampered form.
  const line = await prisma.orderLine.findUnique({
    where: { id: orderLineId },
    select: { kind: true, authorshipMode: true },
  });
  if (!line || !writerStaffableLine(line)) {
    redirect(`/${locale}/desk/orders/${orderId}`);
  }

  await prisma.orderLine.update({
    where: { id: orderLineId },
    data: { assignedWriterId: writerId, assignedById: userId, assignedAt: new Date() },
  });
  await recordAudit(userId, "line.assign", `OrderLine:${orderLineId}`, { writerId });

  redirect(`/${locale}/desk/orders/${orderId}`);
}
