import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/prisma";
import type { Scope } from "@/lib/scope";
import type { Workspace } from "@/lib/workspace";
import { recordAudit } from "@/lib/audit";
import { authorizeQuoteDownload, DESK_PREPARED_BY } from "./quote-download";

// Quote downloads (PDF / DOCX routes) against a real DB: the owning buyer
// gets their sent quote, prepared by the desk member who sent it; another
// organisation and a draft read as "not found"; a replaced quote makes no
// new document.
const RUN_DB_IT = process.env.RUN_DB_IT === "1";

if (!RUN_DB_IT) {
  test("quote download access (skipped — set RUN_DB_IT=1 with a disposable DB)", { skip: true }, () => {});
} else {
  const stamp = Date.now();
  const ids = { orgA: "", orgB: "", buyerA: "", buyerB: "", desk: "", plan: "", request: "", sent: "", draft: "", replaced: "" };

  const buyerScope = (userId: string, orgId: string): Scope => ({
    session: null,
    role: "BUYER",
    userId,
    isDesk: false,
    isPublisher: false,
    workspace: { scopeOrgIds: [orgId] } as unknown as Workspace,
  });

  before(async () => {
    const [orgA, orgB] = await Promise.all([
      prisma.organization.create({ data: { name: `QDL-IT A ${stamp}`, type: "ADVERTISER", marketCode: "NO" } }),
      prisma.organization.create({ data: { name: `QDL-IT B ${stamp}`, type: "ADVERTISER", marketCode: "SE" } }),
    ]);
    ids.orgA = orgA.id;
    ids.orgB = orgB.id;
    const [buyerA, buyerB, desk] = await Promise.all([
      prisma.user.create({ data: { email: `qdl-a-${stamp}@test.invalid`, role: "BUYER", organizationId: orgA.id } }),
      prisma.user.create({ data: { email: `qdl-b-${stamp}@test.invalid`, role: "BUYER", organizationId: orgB.id } }),
      prisma.user.create({ data: { email: `qdl-desk-${stamp}@test.invalid`, name: "Astrid Desk", role: "DESK" } }),
    ]);
    ids.buyerA = buyerA.id;
    ids.buyerB = buyerB.id;
    ids.desk = desk.id;
    const plan = await prisma.plan.create({ data: { organizationId: orgA.id } });
    ids.plan = plan.id;
    const request = await prisma.request.create({
      data: { organizationId: orgA.id, planId: plan.id, status: "QUOTED" },
    });
    ids.request = request.id;
    const quote = (status: "SENT" | "DRAFT" | "SUPERSEDED") =>
      prisma.quote.create({
        data: { requestId: request.id, status, currency: "NOK", subtotal: 1000, vatPct: 25, total: 1250 },
      });
    const [sent, draft, replaced] = await Promise.all([quote("SENT"), quote("DRAFT"), quote("SUPERSEDED")]);
    ids.sent = sent.id;
    ids.draft = draft.id;
    ids.replaced = replaced.id;
    await recordAudit(desk.id, "quote.send", `Quote:${sent.id}`, {});
  });

  after(async () => {
    await prisma.auditLog.deleteMany({
      where: { entity: { in: [ids.sent, ids.draft, ids.replaced].map((id) => `Quote:${id}`) } },
    });
    await prisma.quote.deleteMany({ where: { requestId: ids.request } });
    await prisma.request.deleteMany({ where: { id: ids.request } });
    await prisma.plan.deleteMany({ where: { id: ids.plan } });
    await prisma.user.deleteMany({ where: { id: { in: [ids.buyerA, ids.buyerB, ids.desk] } } });
    await prisma.organization.deleteMany({ where: { id: { in: [ids.orgA, ids.orgB] } } });
  });

  test("the owning buyer downloads their sent quote, prepared by the desk member who sent it", async () => {
    const access = await authorizeQuoteDownload(buyerScope(ids.buyerA, ids.orgA), ids.sent);
    assert.ok(access.ok);
    assert.equal(access.audience, "buyer");
    assert.deepEqual(access.preparedBy, { name: "Astrid Desk", email: `qdl-desk-${stamp}@test.invalid` });
  });

  test("another organisation gets 404, exactly like a missing quote", async () => {
    const other = await authorizeQuoteDownload(buyerScope(ids.buyerB, ids.orgB), ids.sent);
    assert.equal(other.ok, false);
    if (!other.ok) assert.equal(other.response.status, 404);
    const missing = await authorizeQuoteDownload(buyerScope(ids.buyerA, ids.orgA), "no-such-quote");
    if (!missing.ok) assert.equal(missing.response.status, 404);
  });

  test("a draft is the desk's; a replaced quote makes no document; signed out is 401", async () => {
    const draft = await authorizeQuoteDownload(buyerScope(ids.buyerA, ids.orgA), ids.draft);
    if (!draft.ok) assert.equal(draft.response.status, 404);
    else assert.fail("a buyer must not download a draft");

    const replaced = await authorizeQuoteDownload(buyerScope(ids.buyerA, ids.orgA), ids.replaced);
    if (!replaced.ok) assert.equal(replaced.response.status, 409);
    else assert.fail("a superseded quote must not render");

    const anon = await authorizeQuoteDownload({ ...buyerScope("", ids.orgA), userId: undefined }, ids.sent);
    if (!anon.ok) assert.equal(anon.response.status, 401);
    else assert.fail("signed out must be refused");
  });

  test("the desk downloads drafts too, under its own name; an unresolved sender falls back to the desk inbox", async () => {
    const deskScope: Scope = {
      session: { user: { id: ids.desk, name: "Astrid Desk", email: "astrid@nativespin.com" } } as Scope["session"],
      role: "DESK",
      userId: ids.desk,
      isDesk: true,
      isPublisher: false,
      workspace: null,
    };
    const draft = await authorizeQuoteDownload(deskScope, ids.draft);
    assert.ok(draft.ok);
    assert.equal(draft.audience, "desk");
    assert.deepEqual(draft.preparedBy, { name: "Astrid Desk", email: "astrid@nativespin.com" });

    // No quote.send audit row for this one (sent before the trail existed).
    await prisma.quote.update({ where: { id: ids.draft }, data: { status: "SENT" } });
    const buyerCopy = await authorizeQuoteDownload(buyerScope(ids.buyerA, ids.orgA), ids.draft);
    assert.ok(buyerCopy.ok);
    assert.deepEqual(buyerCopy.preparedBy, DESK_PREPARED_BY);
  });
}
