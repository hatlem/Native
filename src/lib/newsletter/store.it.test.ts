import { test, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/prisma";
import { confirmSubscriber, unsubscribeSubscriber, upsertPendingSubscriber } from "./store";

// DB-mutating integration test — skipped unless RUN_DB_IT=1, and only
// against a DISPOSABLE database. Proves the opt-out link in the
// confirmation email survives the confirm click and a re-subscribe.
const RUN_DB_IT = process.env.RUN_DB_IT === "1";

if (!RUN_DB_IT) {
  test("newsletter store integration (skipped — set RUN_DB_IT=1 with a disposable DB)", { skip: true }, () => {});
} else {
  const email = `nl-it-${Date.now()}@example.test`;

  after(async () => {
    await prisma.subscriber.deleteMany({ where: { email } });
  });

  test("the emailed unsubscribe link still works after confirming", async () => {
    const first = await upsertPendingSubscriber({ email, locale: "no", source: "it" });
    assert.deepEqual(await confirmSubscriber(first.confirmRaw), { locale: "no" });
    // Idempotent second click.
    assert.deepEqual(await confirmSubscriber(first.confirmRaw), { locale: "no" });

    assert.deepEqual(await unsubscribeSubscriber(first.unsubRaw), { locale: "no" });
    const row = await prisma.subscriber.findUniqueOrThrow({ where: { email } });
    assert.equal(row.status, "UNSUBSCRIBED");
  });

  test("re-subscribing keeps the same unsubscribe link valid", async () => {
    const again = await upsertPendingSubscriber({ email, locale: "sv", source: "it" });
    const third = await upsertPendingSubscriber({ email, locale: "sv", source: "it" });
    assert.equal(again.unsubRaw, third.unsubRaw);
    assert.notEqual(again.confirmRaw, third.confirmRaw);
    // The first confirm token was superseded; the newest one confirms.
    assert.equal(await confirmSubscriber(again.confirmRaw), null);
    assert.deepEqual(await confirmSubscriber(third.confirmRaw), { locale: "sv" });
    assert.deepEqual(await unsubscribeSubscriber(again.unsubRaw), { locale: "sv" });
  });
}
