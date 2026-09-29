import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getWorkspace } from "@/lib/workspace";
import { readActiveListId, resolveActiveList } from "@/lib/lists";
import { planPath } from "@/lib/plan-path";
import { PlanView } from "./_components/PlanView";

export const dynamic = "force-dynamic";

// /plan has no address of its own once a plan exists: it forwards to the
// active plan's canonical /plan/<listId>, keeping the query (?error=…, ?ok=…)
// that server actions redirect here with. With no list yet it renders the
// start / empty states in place.
export default async function PlanIndexPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  const session = await auth();
  const ws = await getWorkspace(session?.user?.id);
  const active = ws?.activeOrgId
    ? await resolveActiveList(ws.activeOrgId, await readActiveListId())
    : null;
  if (active) redirect(planPath(locale, active.id, sp));
  return <PlanView locale={locale} sp={sp} />;
}
