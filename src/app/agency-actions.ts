"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { MarketCode } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { CLIENT_COOKIE, getWorkspace } from "@/lib/workspace";
import { recordAudit } from "@/lib/audit";

const MARKET_CODES = Object.values(MarketCode) as string[];

function field(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v.trim() : "";
}

export async function createClient(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const session = await auth();
  const ws = await getWorkspace(session?.user?.id);
  if (!ws?.isAgency || !ws.agencyOrgId) {
    redirect(`/${locale}/signin`);
  }

  const name = field(formData, "name");
  const marketCode = field(formData, "market");
  if (!name || !MARKET_CODES.includes(marketCode)) {
    redirect(`/${locale}/agency?error=1`);
  }

  const created = await prisma.organization.create({
    data: {
      name,
      type: "ADVERTISER",
      marketCode: marketCode as MarketCode,
      parentOrgId: ws.agencyOrgId,
    },
  });
  await recordAudit(session?.user?.id ?? null, "client.create", `Organization:${created.id}`, {
    agencyOrgId: ws.agencyOrgId,
    name,
    market: marketCode,
  });
  revalidatePath(`/${locale}/agency`);
  redirect(`/${locale}/agency`);
}

// Bulk-create child client orgs from a newline- or comma-separated
// "Name | MARKET" list. Idempotent on (name, parentOrgId): an existing
// client with the same name under the same agency is skipped, not
// recreated. The form submits a single textarea so an agency operator
// (Sofia's scenario) can paste 5–10 clients in one go instead of
// looping the single-create form. Returns silently to /agency; the
// audit log carries the per-row create / skip outcomes for any later
// finance reconciliation.
export async function createClientsBulk(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const session = await auth();
  const ws = await getWorkspace(session?.user?.id);
  if (!ws?.isAgency || !ws.agencyOrgId) {
    redirect(`/${locale}/signin`);
  }

  const raw = field(formData, "rows");
  if (!raw) redirect(`/${locale}/agency?error=empty`);

  // Parse: one line per client, "Name | MARKET" or "Name, MARKET".
  // Skip blank lines + lines with no recognisable market code.
  const parsed = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(/\s*[|,]\s*/);
      const name = parts[0]?.trim();
      const market = parts[1]?.trim().toUpperCase();
      return { name, market };
    })
    .filter((r) => r.name && MARKET_CODES.includes(r.market || ""));

  if (parsed.length === 0) redirect(`/${locale}/agency?error=parse`);
  if (parsed.length > 50) redirect(`/${locale}/agency?error=toomany`);

  // Single transaction so a partial failure (e.g. unique constraint
  // collision on org name within the agency) rolls back the whole
  // batch — agency operators want "all-or-nothing" semantics, not
  // "we created 7 of 10 and you have to figure out which 3 failed".
  const agencyOrgId = ws.agencyOrgId;
  const created: { id: string; name: string; market: string }[] = [];
  const skipped: { name: string; reason: string }[] = [];

  await prisma.$transaction(async (tx) => {
    for (const row of parsed) {
      const existing = await tx.organization.findFirst({
        where: { parentOrgId: agencyOrgId, name: row.name! },
        select: { id: true },
      });
      if (existing) {
        skipped.push({ name: row.name!, reason: "exists" });
        continue;
      }
      const c = await tx.organization.create({
        data: {
          name: row.name!,
          type: "ADVERTISER",
          marketCode: row.market as MarketCode,
          parentOrgId: agencyOrgId,
        },
      });
      created.push({ id: c.id, name: c.name, market: row.market! });
    }
  });

  await recordAudit(
    session?.user?.id ?? null,
    "client.create_bulk",
    `Organization:${agencyOrgId}`,
    {
      agencyOrgId,
      attempted: parsed.length,
      created: created.length,
      skipped: skipped.length,
      createdRows: created,
      skippedRows: skipped,
    },
  );
  revalidatePath(`/${locale}/agency`);
  redirect(
    `/${locale}/agency?ok=bulk&created=${created.length}&skipped=${skipped.length}`,
  );
}

export async function selectClient(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const clientId = field(formData, "clientId");
  const session = await auth();
  const ws = await getWorkspace(session?.user?.id);
  if (!ws?.isAgency) {
    redirect(`/${locale}/signin`);
  }

  const store = await cookies();
  if (clientId && ws.scopeOrgIds.includes(clientId)) {
    store.set(CLIENT_COOKIE, clientId, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
  } else {
    store.delete(CLIENT_COOKIE);
  }
  redirect(`/${locale}/agency`);
}
