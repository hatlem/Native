import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";

export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function pickPrimaryContact<T extends { id: string; isPrimary: boolean }>(
  contacts: T[],
): T | null {
  if (contacts.length === 0) return null;
  return contacts.find((c) => c.isPrimary) ?? contacts[0];
}

export async function createSalesContact(args: {
  publisherId: string;
  name: string;
  email: string;
  phone?: string;
  role?: string;
  notes?: string;
  actorId: string;
}) {
  const contact = await prisma.salesContact.create({
    data: {
      publisherId: args.publisherId,
      name: args.name.trim(),
      email: normaliseEmail(args.email),
      phone: args.phone?.trim() || null,
      role: args.role?.trim() || null,
      notes: args.notes?.trim() || null,
    },
  });
  await recordAudit(args.actorId, "sales_contact.create", `SalesContact:${contact.id}`, {
    publisherId: args.publisherId,
    email: contact.email,
  });
  return contact;
}

export async function attachContactToTitle(args: {
  salesContactId: string;
  titleId: string;
  isPrimary?: boolean;
  actorId: string;
}) {
  // Demote-then-upsert must be atomic — otherwise a concurrent caller
  // could see the title in a zero-primary state between the two
  // statements, or the partial unique index could reject the upsert
  // mid-flow leaving the previous primary demoted with no replacement.
  const link = await prisma.$transaction(async (tx) => {
    if (args.isPrimary) {
      await tx.salesContactTitle.updateMany({
        where: { titleId: args.titleId, isPrimary: true },
        data: { isPrimary: false },
      });
    }
    return tx.salesContactTitle.upsert({
      where: {
        salesContactId_titleId: {
          salesContactId: args.salesContactId,
          titleId: args.titleId,
        },
      },
      create: {
        salesContactId: args.salesContactId,
        titleId: args.titleId,
        isPrimary: args.isPrimary ?? false,
      },
      update: { isPrimary: args.isPrimary ?? false },
    });
  });
  await recordAudit(args.actorId, "sales_contact.attach", `Title:${args.titleId}`, {
    salesContactId: args.salesContactId,
    isPrimary: link.isPrimary,
  });
  return link;
}

export async function setPrimaryContact(args: {
  salesContactId: string;
  titleId: string;
  actorId: string;
}) {
  return attachContactToTitle({
    salesContactId: args.salesContactId,
    titleId: args.titleId,
    isPrimary: true,
    actorId: args.actorId,
  });
}

export async function detachContactFromTitle(args: {
  salesContactId: string;
  titleId: string;
  actorId: string;
}) {
  await prisma.salesContactTitle.delete({
    where: {
      salesContactId_titleId: {
        salesContactId: args.salesContactId,
        titleId: args.titleId,
      },
    },
  });
  await recordAudit(args.actorId, "sales_contact.detach", `Title:${args.titleId}`, {
    salesContactId: args.salesContactId,
  });
}

export async function listContactsForTitle(titleId: string) {
  const rows = await prisma.salesContactTitle.findMany({
    where: { titleId },
    include: { salesContact: true },
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
  });
  return rows.map((r) => ({
    ...r.salesContact,
    isPrimary: r.isPrimary,
  }));
}

export async function listContactsForPublisher(publisherId: string) {
  return prisma.salesContact.findMany({
    where: { publisherId },
    orderBy: { name: "asc" },
  });
}
