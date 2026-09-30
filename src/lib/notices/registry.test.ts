import { describe, it, test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import {
  NOTICE_KEYS,
  renderNotice,
  renderStoredNotice,
  type NoticeKey,
  type NoticeTemplate,
} from "@/lib/notice-template";
import { NOTICE_LOCALES } from "./messages";
import { noticeEmail } from "./email";

// The guard for "every notice is localized and has a real body".
//
// 1. notify*() only accepts a template (the type has no title/body variant),
//    and the source scan below fails if a call site hands one a finished
//    string anyway.
// 2. Every registered template renders in all six locales with a non-empty
//    title and body, no unresolved ICU placeholder, a link in the reader's
//    locale, and copy that is actually translated (differs from English).
//
// SAMPLES is typed against the registry, so adding a template without a
// sample here is a compile error, and the runtime check catches it too.

type ParamsOf<K extends NoticeKey> = Extract<NoticeTemplate, { key: K }>["params"];

const SAMPLES: { [K in NoticeKey]: ParamsOf<K> } = {
  placementReady: { titleName: "Arkitektur", listName: "ABAX SE", listId: "list1" },
  quoteSent: {
    planName: "Q4 trade press",
    quotes: [{ total: 150610, currency: "NOK" }],
    onRequestCount: 1,
    validUntil: "2026-10-21T23:59:59.000Z",
    requestId: "req1",
  },
  orderConfirmed: { planName: "Q4 trade press", requestId: "req1", orderId: "ord1" },
  orderCompleted: {
    planName: "Q4 trade press",
    orderId: "ord1",
    due: null,
    delivery: { published: 2, total: 2 },
  },
  orderLive: { planName: "Q4 trade press", orderId: "ord1", published: 1, total: 2 },
  programmeAutoSend: { programmeName: "Always on", waveNumber: 2, plannedWaves: 3, requestId: "req1" },
  clientApproved: { planName: "Q4 trade press", listId: "list1" },
  orderInProduction: { planName: "Q4 trade press", orderId: "ord1", placements: 3 },
  orderScheduled: {
    planName: "Q4 trade press",
    orderId: "ord1",
    startsOn: "2026-10-01T00:00:00.000Z",
    endsOn: "2026-11-30T00:00:00.000Z",
  },
  orderCancelled: { planName: "Q4 trade press", orderId: "ord1", reason: "Budget moved to Q1" },
  bookingConfirmed: { titleName: "Verdens Gang (VG)", planName: "Q4 trade press", orderId: "ord1" },
  placementLive: {
    titleName: "Verdens Gang (VG)",
    planName: "Q4 trade press",
    orderId: "ord1",
    liveUrl: "https://www.vg.no/annonsorinnhold/1",
  },
  editorialVeto: {
    titleName: "Verdens Gang (VG)",
    planName: "Q4 trade press",
    orderId: "ord1",
    reason: "Conflicts with our reporting",
  },
  placementProposed: { titleName: "Aftenposten", productType: "NATIVE_ARTICLE", requestId: "req1" },
  placeholderRemoved: { titleName: "Aftenposten", requestId: "req1" },
  invoiceIssued: {
    planName: "Q4 trade press",
    invoiceId: "inv1",
    total: 150610,
    currency: "NOK",
    dueAt: "2026-10-30T00:00:00.000Z",
  },
  creditNoteIssued: {
    planName: "Q4 trade press",
    invoiceId: "inv1",
    amount: 150610,
    currency: "NOK",
    reason: "Campaign withdrawn",
  },
  draftReady: { articleTitle: "Fleet control", articleId: "art1", version: 2, orderId: "ord1" },
  draftSentBack: { articleTitle: "Fleet control", articleId: "art1", version: 2, orderId: null },
  deskDraftApproved: {
    articleTitle: "Fleet control",
    articleId: "art1",
    version: 2,
    orderId: "ord1",
    orgName: "ABAX AS",
  },
  deskChangesRequested: {
    articleTitle: "Fleet control",
    articleId: "art1",
    version: 2,
    orderId: "ord1",
    orgName: "ABAX AS",
    comment: "Add a paragraph on fuel costs",
  },
  writerAssigned: { titleName: "Verdens Gang (VG)", productType: "NATIVE_ARTICLE", orderLineId: "line1" },
  writerChangesRequested: {
    articleTitle: "Fleet control",
    version: 2,
    requestedBy: "client",
    comment: "Add a paragraph on fuel costs",
    orderLineId: "line1",
  },
  rfqSubmitted: {
    orgName: "ABAX AS",
    planName: "Q4 trade press",
    requestId: "req1",
    brief: "Reach fleet managers in construction.",
    budget: { amount: 250000, currency: "NOK" },
    lineCount: 2,
    lines: [
      { titleName: "Verdens Gang (VG)", productType: "NATIVE_ARTICLE", quantity: 1, withContent: true },
      { titleName: "Anlegg & Transport", productType: null, quantity: 1, withContent: false },
    ],
  },
  deskQuoteAccepted: { orgName: "ABAX AS", planName: "Q4 trade press", orderCount: 2, orderId: null },
  deskQuoteRenewal: { orgName: "ABAX AS", planName: "Q4 trade press", requestId: "req1" },
  deskBookingConfirmed: {
    titleName: "Verdens Gang (VG)",
    orgName: "ABAX AS",
    planName: "Q4 trade press",
    orderId: "ord1",
  },
  deskPlacementLive: {
    titleName: "Verdens Gang (VG)",
    orgName: "ABAX AS",
    planName: "Q4 trade press",
    orderId: "ord1",
  },
  deskEditorialVeto: {
    titleName: "Verdens Gang (VG)",
    orgName: "ABAX AS",
    planName: "Q4 trade press",
    orderId: "ord1",
    reason: "Conflicts with our reporting",
  },
  publisherPriceUpdated: {
    titleName: "Aftenposten",
    titleId: "t1",
    productType: "ADVERTORIAL",
    from: 17000,
    to: 17741,
    currency: "NOK",
  },
  publisherLeadTimeUpdated: {
    titleName: "Aftenposten",
    titleId: "t1",
    productType: "ADVERTORIAL",
    from: 10,
    to: 11,
  },
  bookingNew: { orgName: "ABAX AS", via: "instant" },
  publisherOrderCancelled: { orgName: "ABAX AS", reason: "Budget moved to Q1" },
};

function template<K extends NoticeKey>(key: K): NoticeTemplate {
  return { key, params: SAMPLES[key] } as NoticeTemplate;
}

describe("every notice template renders in every locale", () => {
  it("has a sample for every registered key", () => {
    assert.deepEqual(Object.keys(SAMPLES).sort(), [...NOTICE_KEYS].sort());
  });

  for (const key of NOTICE_KEYS) {
    it(key, () => {
      const en = renderNotice(template(key), "en");
      for (const locale of NOTICE_LOCALES) {
        const n = renderNotice(template(key), locale);
        const where = `${key} (${locale})`;
        assert.ok(n.title.trim().length > 0, `${where}: empty title`);
        assert.ok(n.body.trim().length > 0, `${where}: empty body`);
        for (const s of [n.title, n.body]) {
          assert.ok(!/[{}]/.test(s), `${where}: unresolved placeholder in ${JSON.stringify(s)}`);
          assert.ok(!/\bnotices\.|MISSING_MESSAGE/.test(s), `${where}: raw message key in ${JSON.stringify(s)}`);
        }
        assert.ok(
          n.link.startsWith(`/${locale}/`) || /^https:\/\//.test(n.link),
          `${where}: link ${n.link} is not in the reader's locale`,
        );
        if (locale !== "en") {
          assert.notEqual(`${n.title}\n${n.body}`, `${en.title}\n${en.body}`, `${where}: not translated`);
        }
        // What is stored is what re-renders.
        const stored = JSON.parse(JSON.stringify(SAMPLES[key]));
        assert.deepEqual(renderStoredNotice(key, stored, locale), n, `${where}: stored row re-renders differently`);
      }
    });
  }
});

// ---- The bodies carry the real data (BUG-desk-lifecycle-r2-1 / -5, BUG-buyer-plan-r2-4) ----

test("invoice notice formats the amount and due date for the reader", () => {
  const no = renderNotice(template("invoiceIssued"), "no");
  assert.equal(no.title, "Faktura utstedt: Q4 trade press");
  assert.match(no.body, /150\s610\s*kr/);
  assert.match(no.body, /30\. oktober 2026/);
  assert.ok(!/150610|2026-10-30/.test(no.body), "no raw amount or ISO date");
  assert.equal(no.link, "/no/invoices/inv1");
});

test("invoice notice promises the PDF only when it can be downloaded (BUG-final-local-10)", () => {
  const params = SAMPLES.invoiceIssued;
  const withPdf = renderNotice({ key: "invoiceIssued", params: { ...params, pdfAvailable: true } }, "no");
  assert.match(withPdf.body, /laste ned PDF-en/);
  const withoutPdf = renderNotice({ key: "invoiceIssued", params: { ...params, pdfAvailable: false } }, "no");
  assert.doesNotMatch(withoutPdf.body, /PDF/);
  assert.match(withoutPdf.body, /hvordan du betaler/);
  assert.equal(withoutPdf.link, "/no/invoices/inv1");
  // A notice stored before the flag existed never over-promises.
  assert.doesNotMatch(renderNotice({ key: "invoiceIssued", params }, "en").body, /PDF/);
});

test("a revised quote goes through the same template, per reader", () => {
  const revised: NoticeTemplate = { key: "quoteSent", params: { ...SAMPLES.quoteSent, revision: 2 } };
  const no = renderNotice(revised, "no");
  assert.equal(no.title, "Tilbudet ditt er revidert (revisjon 2): Q4 trade press");
  assert.match(no.body, /erstatter tilbudet du fikk tidligere/);
  assert.match(renderNotice(revised, "fi").title, /versio 2/);
});

test("the desk's new-request notice lists plan, budget, brief and lines", () => {
  const en = renderNotice(template("rfqSubmitted"), "en");
  assert.equal(en.title, "New request from ABAX AS: Q4 trade press");
  assert.match(en.body, /ABAX AS submitted “Q4 trade press” with 2 lines\./);
  assert.match(en.body, /Budget: NOK\s?250,000/);
  assert.match(en.body, /Reach fleet managers in construction\./);
  assert.match(en.body, /• Verdens Gang \(VG\) — Native article × 1, written by NativeSpin/);
  assert.match(en.body, /• Anlegg & Transport — the desk proposes the placement/);
});

test("a buyer's change request reaches the desk with the comment, and the writer", () => {
  const desk = renderNotice(template("deskChangesRequested"), "no");
  assert.match(desk.body, /Kommentaren deres: «Add a paragraph on fuel costs»/);
  assert.equal(desk.link, "/no/desk/orders/ord1", "the desk order, not the buyer's article route");
  const writer = renderNotice(template("writerChangesRequested"), "no");
  assert.equal(writer.title, "Endringer ønsket: Fleet control");
  assert.match(writer.body, /Kunden har sendt versjon 2/);
  assert.match(writer.body, /Add a paragraph on fuel costs/);
  assert.equal(writer.link, "/no/writer/lines/line1");
});

test("writer assignment is in the writer's language with a link in that locale", () => {
  const no = renderNotice(template("writerAssigned"), "no");
  assert.equal(no.title, "Nytt oppdrag: Verdens Gang (VG)");
  assert.match(no.body, /Native-artikkel/);
  assert.equal(no.link, "/no/writer/lines/line1");
});

test("order status notices name the plan and say something", () => {
  const scheduled = renderNotice(template("orderScheduled"), "no");
  assert.equal(scheduled.title, "Kampanjen er planlagt: Q4 trade press");
  assert.match(scheduled.body, /1\. oktober 2026–30\. november 2026/);
  const undated = renderNotice(
    { key: "orderScheduled", params: { ...SAMPLES.orderScheduled, startsOn: null, endsOn: null } },
    "en",
  );
  assert.match(undated.body, /Every placement has a slot/);
  assert.match(renderNotice(template("orderInProduction"), "en").body, /the 3 placements/);
});

test("notice emails carry localized chrome — no trailing English 'View:'", () => {
  const n = renderNotice(template("clientApproved"), "no");
  const mail = noticeEmail("buyer@example.test", n, "no");
  assert.equal(mail.subject, "Kunden godkjente: Q4 trade press");
  assert.match(mail.text, /\n\nÅpne i NativeSpin: https?:\/\/\S+\/no\/plan\/list1$/);
  assert.ok(!/\bView\b/.test(mail.text + mail.html), "no English chrome");
  assert.match(mail.html, /Åpne i NativeSpin/);
  assert.match(mail.html, /Dette er et automatisk varsel fra NativeSpin\./);
  // An external link (a publisher's live URL) is kept as is.
  const live = noticeEmail("b@example.test", renderNotice(template("placementLive"), "de"), "de");
  assert.match(live.text, /In NativeSpin öffnen: https:\/\/www\.vg\.no\/annonsorinnhold\/1$/);
});

// ---- No call site hands notify*() a finished string ----

const SRC = join(__dirname, "..", "..");

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name !== "node_modules" && name !== "messages") sourceFiles(p, out);
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) {
      out.push(p);
    }
  }
  return out;
}

/** The argument text of every notify*( call in `src`, parens balanced. */
function notifyCalls(src: string): string[] {
  const calls: string[] = [];
  const re = /\bnotify(?:Desk|Org|Publisher|User)\(/g;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    let depth = 1;
    let i = m.index + m[0].length;
    for (; i < src.length && depth > 0; i++) {
      if (src[i] === "(") depth++;
      else if (src[i] === ")") depth--;
    }
    calls.push(src.slice(m.index, i));
  }
  return calls;
}

test("every notify*() call passes a template, never a hard-coded title or body", () => {
  const offenders: string[] = [];
  let seen = 0;
  for (const file of sourceFiles(SRC)) {
    if (file.endsWith(join("lib", "notify.ts"))) continue; // the definitions
    const src = readFileSync(file, "utf8");
    for (const call of notifyCalls(src)) {
      seen++;
      if (!/\btemplate\b/.test(call) || /\b(title|body)\s*:/.test(call)) {
        offenders.push(`${relative(SRC, file)}: ${call.slice(0, 120).replace(/\s+/g, " ")}`);
      }
    }
  }
  assert.ok(seen >= 30, `found only ${seen} notify calls — is the scan still reading src?`);
  assert.deepEqual(offenders, []);
});
