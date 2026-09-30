import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { OrgType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { disableListShare, enableListShare } from "@/lib/list-share";
import type { Scope } from "@/lib/scope";
import { loadWorkspace } from "@/lib/workspace";
import { authorizePlanDownload, planDocumentLink, planDownloadResponse } from "./plan-download";
import { zipEntry } from "./zip-entry";

// The plan download against a real DB. Who gets the team's copy: anyone with
// read access to the plan's org, a view-only (RESTRICTED) seat included;
// another org, a missing and an archived plan are one indistinguishable 404.
// Who gets the client's copy: whoever holds a live share token; a disabled or
// rotated link is a 404 like the share page. Both render real documents.
//
// Workspaces are built by the real loadWorkspace from the seats in the DB, so
// the access decision is the one production makes. The share route handler is
// called directly (it needs no session).
const RUN_DB_IT = process.env.RUN_DB_IT === "1";

if (!RUN_DB_IT) {
  test("plan download access (skipped — set RUN_DB_IT=1 with a disposable DB)", { skip: true }, () => {});
} else {
  const REF = `pdl-it-${Date.now()}`;
  const ids = {
    publisher: "",
    title: "",
    product: "",
    orgA: "",
    orgB: "",
    member: "",
    viewer: "",
    outsider: "",
    list: "",
    archived: "",
  };

  let shareRoute: typeof import("@/app/api/export/shared-plan/[token]/[format]/route");

  const scopeFor = async (userId: string): Promise<Scope> => ({
    session: null,
    role: "BUYER",
    userId,
    isDesk: false,
    isPublisher: false,
    workspace: await loadWorkspace(userId, null),
  });

  // A fresh client IP per call, so the per-IP share limit only bites where a
  // test means it to.
  let ipSeq = 0;
  const shareGet = (token: string, format: string, ip = `198.51.100.${++ipSeq}`) =>
    shareRoute.GET(
      new Request(`http://localhost/api/export/shared-plan/${token}/${format}?locale=no`, {
        headers: { "x-forwarded-for": ip },
      }),
      { params: Promise.resolve({ token, format }) },
    );

  before(async () => {
    shareRoute = await import("@/app/api/export/shared-plan/[token]/[format]/route");
    const market = await prisma.market.findFirstOrThrow({ where: { code: "NO" } });
    ids.publisher = (
      await prisma.publisher.create({ data: { name: `PDL-IT publisher ${REF}`, countryCode: "NO", marketId: market.id } })
    ).id;
    ids.title = (
      await prisma.title.create({
        data: {
          name: "PDL-IT Title",
          slug: REF,
          publisherId: ids.publisher,
          countryCode: "NO",
          marketId: market.id,
          category: "business",
          active: true,
          digitalReach: 41000,
        },
      })
    ).id;
    ids.product = (
      await prisma.product.create({
        data: {
          titleId: ids.title,
          type: "NATIVE_ARTICLE",
          name: "PDL-IT native",
          basePrice: 29000,
          // The offer's own article fee, so the band below doesn't move with
          // whatever the desk's fee rules hold in the test database.
          productionFee: 12000,
          currency: "NOK",
          visibility: "INDICATIVE",
          confirmedAt: new Date(),
        },
      })
    ).id;
    const [orgA, orgB] = await Promise.all([
      prisma.organization.create({ data: { name: `PDL-IT A ${REF}`, type: OrgType.ADVERTISER, marketCode: "NO" } }),
      prisma.organization.create({ data: { name: `PDL-IT B ${REF}`, type: OrgType.ADVERTISER, marketCode: "SE" } }),
    ]);
    ids.orgA = orgA.id;
    ids.orgB = orgB.id;
    const user = (tag: string, organizationId: string) =>
      prisma.user.create({ data: { email: `${REF}-${tag}@example.test`, role: "BUYER", organizationId } });
    const [member, viewer, outsider] = await Promise.all([
      user("member", orgA.id),
      user("viewer", orgA.id),
      user("outsider", orgB.id),
    ]);
    ids.member = member.id;
    ids.viewer = viewer.id;
    ids.outsider = outsider.id;
    await prisma.membership.createMany({
      data: [
        { userId: member.id, organizationId: orgA.id, role: "MEMBER", canCommit: true, status: "ACTIVE" },
        { userId: viewer.id, organizationId: orgA.id, role: "RESTRICTED", canCommit: false, status: "ACTIVE" },
        { userId: outsider.id, organizationId: orgB.id, role: "ADMIN", canCommit: true, status: "ACTIVE" },
      ],
    });
    ids.list = (
      await prisma.savedList.create({
        data: {
          organizationId: orgA.id,
          name: "PDL-IT plan",
          briefText: "Fleet tracking for contractors",
          items: {
            create: [
              {
                productId: ids.product,
                quantity: 1,
                withContent: true,
                authorshipMode: "NATIVESPIN_PRODUCED",
                notes: "Machinery issue",
              },
              { titleId: ids.title, quantity: 1, sortOrder: 1 },
            ],
          },
        },
      })
    ).id;
    ids.archived = (
      await prisma.savedList.create({ data: { organizationId: orgA.id, name: "PDL-IT old", archivedAt: new Date() } })
    ).id;
  });

  after(async () => {
    await prisma.auditLog.deleteMany({
      where: { entity: { in: [ids.list, ids.archived].map((id) => `SavedList:${id}`) } },
    });
    await prisma.savedListItem.deleteMany({ where: { list: { organizationId: ids.orgA } } });
    await prisma.savedList.deleteMany({ where: { organizationId: ids.orgA } });
    await prisma.membership.deleteMany({ where: { organizationId: { in: [ids.orgA, ids.orgB] } } });
    await prisma.user.deleteMany({ where: { id: { in: [ids.member, ids.viewer, ids.outsider] } } });
    await prisma.organization.deleteMany({ where: { id: { in: [ids.orgA, ids.orgB] } } });
    await prisma.product.deleteMany({ where: { id: ids.product } });
    await prisma.title.deleteMany({ where: { id: ids.title } });
    await prisma.publisher.deleteMany({ where: { id: ids.publisher } });
  });

  test("a member of the owning org downloads the plan, brief and all", async () => {
    const access = await authorizePlanDownload(await scopeFor(ids.member), ids.list);
    assert.ok(access.ok);
    assert.equal(access.list.id, ids.list);
    assert.equal(access.list.briefText, "Fleet tracking for contractors");

    const res = await planDownloadResponse({
      list: access.list,
      brief: access.list,
      audience: "team",
      link: planDocumentLink(access.list.id, access.list.shareToken, "no"),
      format: "docx",
      locale: "no",
      actor: access.userId,
    });
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-disposition") ?? "", /filename\*=UTF-8''NativeSpin%20%E2%80%93%20PDL-IT%20plan%20%E2%80%93%20\d{4}-\d{2}-\d{2}\.docx/);
    const xml = zipEntry(Buffer.from(await res.arrayBuffer()), "word/document.xml");
    assert.ok(xml.includes("PDL-IT Title"));
    assert.ok(xml.includes("≈ 40–60k NOK"), "the INDICATIVE line is its band");
    assert.ok(xml.includes("Fleet tracking for contractors"), "the team's copy carries the brief");
    assert.ok(xml.includes(`/no/plan/${ids.list}`), "no share link yet: it points at the plan");
    assert.ok(xml.includes("Konto → Team"), "…and says how to invite colleagues");

    const audit = await prisma.auditLog.findFirst({
      where: { entity: `SavedList:${ids.list}`, action: "plan.docx.download", actor: ids.member },
    });
    assert.ok(audit, "the download is audited");
  });

  test("a view-only (RESTRICTED) seat downloads it too", async () => {
    const access = await authorizePlanDownload(await scopeFor(ids.viewer), ids.list);
    assert.ok(access.ok);
  });

  test("another org, a missing plan and an archived plan are the same 404; signed out is 401", async () => {
    for (const listId of [ids.list, "no-such-list"]) {
      const other = await authorizePlanDownload(await scopeFor(ids.outsider), listId);
      assert.equal(other.ok, false);
      if (!other.ok) assert.equal(other.response.status, 404);
    }
    const archived = await authorizePlanDownload(await scopeFor(ids.member), ids.archived);
    if (!archived.ok) assert.equal(archived.response.status, 404);
    else assert.fail("an archived plan must not download");

    const anon = await authorizePlanDownload({ ...(await scopeFor(ids.member)), userId: undefined }, ids.list);
    if (!anon.ok) assert.equal(anon.response.status, 401);
    else assert.fail("signed out must be refused");
  });

  test("the share token downloads the client's copy; the team's copy then points at the share link", async () => {
    const token = await enableListShare(ids.list);

    const pdf = await shareGet(token, "pdf");
    assert.equal(pdf.status, 200);
    assert.equal(pdf.headers.get("content-type"), "application/pdf");
    assert.equal(pdf.headers.get("x-robots-tag"), "noindex, nofollow");
    assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString(), "%PDF-");

    const docx = await shareGet(token, "docx");
    assert.equal(docx.status, 200);
    const xml = zipEntry(Buffer.from(await docx.arrayBuffer()), "word/document.xml");
    assert.ok(xml.includes(`/no/share/${token}`), "the client's copy links the share page");
    assert.ok(!xml.includes("Fleet tracking"), "the brief stays with the team");
    assert.ok(xml.includes("Machinery issue"), "customer line notes are on it, as on the share page");

    const audited = await prisma.auditLog.count({
      where: { entity: `SavedList:${ids.list}`, action: { in: ["plan.pdf.download", "plan.docx.download"] }, actor: "system" },
    });
    assert.equal(audited, 2);

    const team = await authorizePlanDownload(await scopeFor(ids.member), ids.list);
    assert.ok(team.ok);
    assert.equal(planDocumentLink(ids.list, team.list.shareToken, "no").url.endsWith(`/no/share/${token}`), true);

    assert.equal((await shareGet(token, "xlsx")).status, 404, "unknown formats are not found");
  });

  test("a disabled or rotated share link no longer downloads", async () => {
    const first = await enableListShare(ids.list);
    const second = await enableListShare(ids.list);
    assert.equal((await shareGet(first, "pdf")).status, 404, "rotated");
    assert.equal((await shareGet(second, "pdf")).status, 200);

    await disableListShare(ids.list);
    assert.equal((await shareGet(second, "pdf")).status, 404, "disabled");
    assert.equal((await shareGet("x".repeat(43), "pdf")).status, 404, "never issued");
  });

  test("the share download is rate limited per IP", async () => {
    const statuses: number[] = [];
    // Unknown token: the limit is checked before the lookup, so guessing is
    // capped too, and nothing is rendered while counting.
    for (let i = 0; i < 11; i++) statuses.push((await shareGet("y".repeat(43), "pdf", "203.0.113.77")).status);
    assert.deepEqual(statuses.slice(0, 10), Array(10).fill(404));
    assert.equal(statuses[10], 429);
    // Another client is unaffected.
    assert.equal((await shareGet("y".repeat(43), "pdf", "203.0.113.78")).status, 404);
  });
}
