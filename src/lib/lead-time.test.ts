import { test } from "node:test";
import assert from "node:assert/strict";
import { ESTIMATED_LEAD_TIME_DAYS, productLeadTime, titleLeadTime } from "./lead-time";

test("a stated lead time wins over the estimate", () => {
  assert.deepEqual(productLeadTime(5), { days: 5, estimated: false });
  assert.deepEqual(productLeadTime(null), { days: ESTIMATED_LEAD_TIME_DAYS, estimated: true });
});

// BUG-prod-api-3: compare showed "—" where the detail page said "estimated 10 days".
test("title lead time: fastest stated, else the platform estimate", () => {
  assert.deepEqual(titleLeadTime([{ leadTimeDays: 14 }, { leadTimeDays: null }, { leadTimeDays: 7 }]), {
    days: 7,
    estimated: false,
  });
  assert.deepEqual(titleLeadTime([{ leadTimeDays: null }]), { days: ESTIMATED_LEAD_TIME_DAYS, estimated: true });
  assert.deepEqual(titleLeadTime([]), { days: ESTIMATED_LEAD_TIME_DAYS, estimated: true });
});
