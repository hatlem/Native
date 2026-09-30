import { redirect } from "next/navigation";
import { readActiveListId } from "@/lib/lists";
import { openPlanPath } from "@/lib/plan-path";
import { PlanView } from "../_components/PlanView";

export const dynamic = "force-dynamic";

// The canonical address of one plan. The page's own forms post this listId
// (lib/plan-target.ts), but off-page adds (the catalog's "Add to plan") go to
// the active-list cookie, so opening a plan makes it the active one: the page
// only renders once the cookie names this list, otherwise it detours through
// /plan/open, which checks access, writes the cookie and comes straight back.
// A list the viewer can't open ends on /plan instead, never on another plan
// under this address.
export default async function PlanListPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; listId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, listId } = await params;
  const sp = await searchParams;
  if ((await readActiveListId()) !== listId) redirect(openPlanPath(locale, listId, sp));
  return <PlanView locale={locale} sp={sp} expectedListId={listId} />;
}
