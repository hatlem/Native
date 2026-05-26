"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import {
  createSalesContact,
  attachContactToTitle,
  setPrimaryContact,
  detachContactFromTitle,
} from "@/lib/pricing/contacts";
import {
  createPriceRequest,
  createPriceRequestsBulk,
  sendPriceRequest,
  cancelPriceRequest,
  resendPriceRequest,
} from "@/lib/pricing/requests";
import {
  applyQuote,
  rejectQuote,
  editPendingQuote,
  logQuote,
} from "@/lib/pricing/quotes";

function field(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v.trim() : "";
}

function optionalField(formData: FormData, key: string): string | undefined {
  const v = field(formData, key);
  return v.length ? v : undefined;
}

async function requireSuperadmin(locale: string): Promise<string> {
  const session = await auth();
  if (session?.user?.role !== "SUPERADMIN") {
    redirect(`/${locale}/signin`);
  }
  return session.user.id;
}

// ---- Sales contacts ----

export async function createSalesContactAction(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const userId = await requireSuperadmin(locale);
  const titleId = field(formData, "titleId");
  const contact = await createSalesContact({
    publisherId: field(formData, "publisherId"),
    name: field(formData, "name"),
    email: field(formData, "email"),
    phone: optionalField(formData, "phone"),
    role: optionalField(formData, "role"),
    notes: optionalField(formData, "notes"),
    actorId: userId,
  });
  if (titleId) {
    await attachContactToTitle({
      salesContactId: contact.id,
      titleId,
      isPrimary: formData.get("makePrimary") === "on",
      actorId: userId,
    });
  }
  if (titleId) revalidatePath(`/${locale}/desk/titles/${titleId}`);
}

export async function attachContactAction(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const userId = await requireSuperadmin(locale);
  const titleId = field(formData, "titleId");
  await attachContactToTitle({
    salesContactId: field(formData, "salesContactId"),
    titleId,
    isPrimary: formData.get("makePrimary") === "on",
    actorId: userId,
  });
  revalidatePath(`/${locale}/desk/titles/${titleId}`);
}

export async function setPrimaryContactAction(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const userId = await requireSuperadmin(locale);
  const titleId = field(formData, "titleId");
  await setPrimaryContact({
    salesContactId: field(formData, "salesContactId"),
    titleId,
    actorId: userId,
  });
  revalidatePath(`/${locale}/desk/titles/${titleId}`);
}

export async function detachContactAction(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const userId = await requireSuperadmin(locale);
  const titleId = field(formData, "titleId");
  await detachContactFromTitle({
    salesContactId: field(formData, "salesContactId"),
    titleId,
    actorId: userId,
  });
  revalidatePath(`/${locale}/desk/titles/${titleId}`);
}

// ---- Price requests ----

export async function createAndSendRequestAction(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const userId = await requireSuperadmin(locale);
  const titleId = field(formData, "titleId");
  const req = await createPriceRequest({
    titleId,
    salesContactId: field(formData, "salesContactId"),
    requestedById: userId,
  });
  await sendPriceRequest({ priceRequestId: req.id, actorId: userId });
  revalidatePath(`/${locale}/desk/titles/${titleId}`);
}

export async function createPriceRequestsBulkAction(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const userId = await requireSuperadmin(locale);
  const titleIds = formData
    .getAll("titleIds")
    .filter((v): v is string => typeof v === "string");
  await createPriceRequestsBulk({
    titleIds,
    requestedById: userId,
    send: true,
  });
  revalidatePath(`/${locale}/desk/titles`);
}

export async function cancelPriceRequestAction(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const userId = await requireSuperadmin(locale);
  await cancelPriceRequest({
    priceRequestId: field(formData, "priceRequestId"),
    actorId: userId,
  });
  revalidatePath(`/${locale}/desk/titles/${field(formData, "titleId")}`);
}

export async function resendPriceRequestAction(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const userId = await requireSuperadmin(locale);
  await resendPriceRequest({
    priceRequestId: field(formData, "priceRequestId"),
    actorId: userId,
  });
  revalidatePath(`/${locale}/desk/titles/${field(formData, "titleId")}`);
}

export async function logManualResponseAction(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const userId = await requireSuperadmin(locale);
  const titleId = field(formData, "titleId");
  await logQuote({
    priceRequestId: optionalField(formData, "priceRequestId"),
    productId: field(formData, "productId"),
    price: Number(field(formData, "price")),
    currency: field(formData, "currency"),
    includedText: optionalField(formData, "includedText"),
    excludedText: optionalField(formData, "excludedText"),
    recordedById: userId,
  });
  revalidatePath(`/${locale}/desk/titles/${titleId}`);
}

// ---- Quotes ----

export async function applyQuoteAction(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const userId = await requireSuperadmin(locale);
  await applyQuote({
    quoteId: field(formData, "quoteId"),
    actorUserId: userId,
  });
  revalidatePath(`/${locale}/desk/titles/${field(formData, "titleId")}`);
  revalidatePath(`/${locale}/desk/price-quotes`);
}

export async function rejectQuoteAction(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const userId = await requireSuperadmin(locale);
  await rejectQuote({
    quoteId: field(formData, "quoteId"),
    reason: optionalField(formData, "reason"),
    actorUserId: userId,
  });
  revalidatePath(`/${locale}/desk/titles/${field(formData, "titleId")}`);
  revalidatePath(`/${locale}/desk/price-quotes`);
}

export async function editPendingQuoteAction(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const userId = await requireSuperadmin(locale);
  const price = field(formData, "price");
  const currency = field(formData, "currency");
  await editPendingQuote({
    quoteId: field(formData, "quoteId"),
    price: price ? Number(price) : undefined,
    currency: currency || undefined,
    includedText: optionalField(formData, "includedText"),
    excludedText: optionalField(formData, "excludedText"),
    actorUserId: userId,
  });
  revalidatePath(`/${locale}/desk/titles/${field(formData, "titleId")}`);
}
