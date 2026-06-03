import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import type { ContactChannel, ContactDirection } from "@prisma/client";

export type CreateContactLogArgs = {
  titleId: string;
  salesContactId?: string;
  channel: ContactChannel;
  direction?: ContactDirection;
  contactedAt?: Date;
  note?: string;
  actorId: string;
};

export async function createContactLog(args: CreateContactLogArgs) {
  const entry = await prisma.contactLog.create({
    data: {
      titleId: args.titleId,
      salesContactId: args.salesContactId ?? null,
      channel: args.channel,
      direction: args.direction ?? "OUTBOUND",
      contactedAt: args.contactedAt ?? new Date(),
      note: args.note ?? null,
      contactedById: args.actorId,
    },
  });
  await recordAudit(args.actorId, "contact_log.create", `ContactLog:${entry.id}`, {
    titleId: args.titleId,
    channel: args.channel,
    direction: entry.direction,
  });
  return entry;
}

export function listForTitle(titleId: string) {
  return prisma.contactLog.findMany({
    where: { titleId },
    orderBy: { contactedAt: "desc" },
    include: {
      salesContact: true,
      quotes: {
        include: { product: true },
        orderBy: { recordedAt: "desc" },
      },
    },
  });
}

export type EditContactLogArgs = {
  id: string;
  channel?: ContactChannel;
  direction?: ContactDirection;
  contactedAt?: Date;
  note?: string | null;
  salesContactId?: string | null;
  actorId: string;
};

export async function editContactLog(args: EditContactLogArgs) {
  const entry = await prisma.contactLog.update({
    where: { id: args.id },
    data: {
      channel: args.channel,
      direction: args.direction,
      contactedAt: args.contactedAt,
      note: args.note,
      salesContactId: args.salesContactId,
    },
  });
  await recordAudit(args.actorId, "contact_log.update", `ContactLog:${entry.id}`, {
    channel: args.channel,
    direction: args.direction,
  });
  return entry;
}

export async function deleteContactLog(args: { id: string; actorId: string }) {
  await prisma.contactLog.delete({ where: { id: args.id } });
  await recordAudit(args.actorId, "contact_log.delete", `ContactLog:${args.id}`, {});
}
