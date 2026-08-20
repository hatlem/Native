import { test } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "./prisma";
import { linkWaveArticle, ProgrammeError } from "./programme";

// Regression coverage for the domain-layer guard added to linkWaveArticle:
// a wave (SavedList) may only link to an Article in its own organization.
// linkWaveArticleAction already checks this before calling in, but this
// test targets the lib function directly so the invariant holds even if a
// future caller skips (or races) the action's own check.
const RUN_DB_IT = process.env.RUN_DB_IT === "1";

test(
  "linkWaveArticle rejects an article from a different organization, leaves the list unlinked",
  { skip: !RUN_DB_IT },
  async () => {
    const orgA = await prisma.organization.create({ data: { name: "Wave-Link IT Org A", type: "ADVERTISER" } });
    const orgB = await prisma.organization.create({ data: { name: "Wave-Link IT Org B", type: "ADVERTISER" } });
    const userA = await prisma.user.create({
      data: { email: `it-wla-a-${Date.now()}@example.com`, role: "BUYER", organizationId: orgA.id },
    });
    const userB = await prisma.user.create({
      data: { email: `it-wla-b-${Date.now()}@example.com`, role: "BUYER", organizationId: orgB.id },
    });
    const list = await prisma.savedList.create({ data: { organizationId: orgA.id, name: "Wave 1" } });
    const foreignArticle = await prisma.article.create({
      data: { organizationId: orgB.id, title: "Org B's piece", createdByUserId: userB.id, createdByRole: "BUYER" },
    });

    await assert.rejects(
      () => linkWaveArticle(list.id, foreignArticle.id),
      (e: unknown) => e instanceof ProgrammeError && e.code === "cross-org",
    );
    const reloaded = await prisma.savedList.findUniqueOrThrow({ where: { id: list.id } });
    assert.equal(reloaded.articleId, null);

    // Same-org link still succeeds — the guard rejects cross-org, not
    // linking itself.
    const ownArticle = await prisma.article.create({
      data: { organizationId: orgA.id, title: "Org A's piece", createdByUserId: userA.id, createdByRole: "BUYER" },
    });
    await linkWaveArticle(list.id, ownArticle.id);
    const linked = await prisma.savedList.findUniqueOrThrow({ where: { id: list.id } });
    assert.equal(linked.articleId, ownArticle.id);

    await prisma.savedList.delete({ where: { id: list.id } });
    await prisma.article.deleteMany({ where: { id: { in: [foreignArticle.id, ownArticle.id] } } });
    await prisma.notification.deleteMany({ where: { userId: { in: [userA.id, userB.id] } } });
    await prisma.user.deleteMany({ where: { id: { in: [userA.id, userB.id] } } });
    await prisma.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } });
  },
);

test(
  "linkWaveArticle rejects a nonexistent listId as not-found",
  { skip: !RUN_DB_IT },
  async () => {
    const org = await prisma.organization.create({ data: { name: "Wave-Link IT Org C", type: "ADVERTISER" } });
    const user = await prisma.user.create({
      data: { email: `it-wla-c-${Date.now()}@example.com`, role: "BUYER", organizationId: org.id },
    });
    const article = await prisma.article.create({
      data: { organizationId: org.id, title: "Org C's piece", createdByUserId: user.id, createdByRole: "BUYER" },
    });

    await assert.rejects(
      () => linkWaveArticle("nonexistent-list-id", article.id),
      (e: unknown) => e instanceof ProgrammeError && e.code === "not-found",
    );

    await prisma.article.delete({ where: { id: article.id } });
    await prisma.notification.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
    await prisma.organization.delete({ where: { id: org.id } });
  },
);
