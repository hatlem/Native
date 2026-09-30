// The shape every notice template shares (see src/lib/notice-template.ts):
// a zod schema for its stored params and a pure render into one locale.
// Params are validated on READ too, so a row written by an older deploy with
// a different shape falls back to its stored strings instead of throwing.

import { z } from "zod";
import type { BuyerLocale } from "@/lib/market-locale";

export type RenderedNotice = { title: string; body: string; link: string };

export type Template<S extends z.ZodType> = {
  params: S;
  render: (params: z.infer<S>, locale: BuyerLocale) => RenderedNotice;
};

// Identity helper: ties each render's parameter type to its own schema.
export function defineTemplate<S extends z.ZodType>(t: Template<S>): Template<S> {
  return t;
}

export const id = z.string().min(1);
export const isoDateTime = z.iso.datetime();
// Free text a person typed (a cancellation reason, a review comment).
// Bounded so a stored row can't carry an unbounded blob into every email.
export const freeText = z.string().max(4000);

/** Paragraphs of a notice body, blank-line separated (rendered with
 *  white-space: pre-line in the inbox and the email). */
export function paragraphs(...parts: (string | null | undefined | false)[]): string {
  return parts.filter((p): p is string => typeof p === "string" && p.length > 0).join("\n\n");
}
