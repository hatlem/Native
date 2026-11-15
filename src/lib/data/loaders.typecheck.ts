// Compile-time proof that a data loader cannot be called without its
// authorisation context. Nothing imports this file and nothing in it runs:
// `pnpm typecheck` fails if any `@ts-expect-error` below stops being an
// error — i.e. if a loader becomes callable without a guard.

import type { DeskContext, SuperadminContext } from "@/lib/desk-guard";
import type { BuyerScope } from "@/lib/data/buyer/guard";
import { loadPlaybooks } from "@/lib/data/desk/playbooks";
import { loadDetailOrder as loadDeskOrder } from "@/lib/data/desk/orders";
import { loadKeys } from "@/lib/data/desk/api-keys";
import { loadListTotal, loadDetailInvoice } from "@/lib/data/buyer/invoices";
import { loadListRequests } from "@/lib/data/buyer/requests";

declare const desk: DeskContext;
declare const superadmin: SuperadminContext;
declare const scope: BuyerScope;

export async function neverCalled(): Promise<void> {
  // The supported calls compile.
  await loadPlaybooks(desk);
  await loadDeskOrder(desk, { orderId: "x" });
  await loadKeys(superadmin);
  await loadPlaybooks(superadmin); // a superadmin is desk too
  await loadListTotal(scope);
  await loadDetailInvoice(scope, { id: "x" });

  // No context at all.
  // @ts-expect-error a desk loader needs a DeskContext
  await loadPlaybooks();
  // @ts-expect-error a desk loader needs a DeskContext before its arguments
  await loadDeskOrder({ orderId: "x" });
  // @ts-expect-error a buyer loader needs the caller's scope
  await loadListTotal();
  // @ts-expect-error a buyer loader needs the caller's scope
  await loadListRequests();

  // A look-alike object is not a context: only a guard in lib/desk-guard can
  // mint one (the brand is not exported).
  // @ts-expect-error not minted by a guard
  await loadPlaybooks({ userId: "u", role: "DESK" });
  // @ts-expect-error a user id is not a context
  await loadPlaybooks("user-id");

  // A desk context does not open a SUPERADMIN-only loader.
  // @ts-expect-error DESK is not SUPERADMIN
  await loadKeys(desk);

  // The buyer's scope is not a desk context, and the other way round.
  // @ts-expect-error a buyer scope is not a desk context
  await loadPlaybooks(scope);
  // @ts-expect-error a desk context is not a buyer scope
  await loadListTotal(desk);
}
