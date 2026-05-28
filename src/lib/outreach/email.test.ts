import { test } from "node:test";
import assert from "node:assert/strict";
import { buildOutreachEmail, localeForMarketCode } from "./email";

const titles = [
  { name: "Aftenposten", marketCode: "NO" as const },
  { name: "Bergens Tidende", marketCode: "NO" as const },
  { name: "Adresseavisen", marketCode: "NO" as const },
];

test("localeForMarketCode covers all 9 markets", () => {
  assert.equal(localeForMarketCode("NO"), "no");
  assert.equal(localeForMarketCode("SE"), "sv");
  assert.equal(localeForMarketCode("DK"), "da");
  assert.equal(localeForMarketCode("FI"), "fi");
  assert.equal(localeForMarketCode("DE"), "de");
  assert.equal(localeForMarketCode("AT"), "de");
  assert.equal(localeForMarketCode("CH"), "de");
  assert.equal(localeForMarketCode("UK"), "en");
  assert.equal(localeForMarketCode("IE"), "en");
});

test("initial NO email contains hook + title list + link + unsubscribe", () => {
  const built = buildOutreachEmail({
    step: "initial",
    locale: "no",
    recipientName: "Annonseteam",
    titles,
    link: "https://nativespin.com/no/rate-card/abc",
    unsubscribeLink: "https://nativespin.com/no/rate-card/abc/unsubscribe",
  });
  assert.match(built.subject, /native|rate card|prisforespørsel/i);
  assert.match(built.text, /annonsør vi ønsker/);
  assert.match(built.text, /Svar gjerne direkte på denne e-posten/);
  assert.match(built.text, /Elias Getia, NativeSpin/);
  assert.match(built.text, /Aftenposten/);
  assert.match(built.text, /Bergens Tidende/);
  assert.match(built.text, /https:\/\/nativespin\.com\/no\/rate-card\/abc/);
  assert.match(built.text, /Avregistrer/);
});

test("bump1 is short, references the previous mail, contains link", () => {
  const built = buildOutreachEmail({
    step: "bump1",
    locale: "no",
    recipientName: "Kari",
    titles,
    link: "https://x.test",
    unsubscribeLink: "https://x.test/u",
  });
  assert.match(built.subject, /^Re:/i);
  assert.ok(built.text.length < 800, "bump should be short");
});

test("bump2 is breakaway with point-to-right-person ask", () => {
  const built = buildOutreachEmail({
    step: "bump2",
    locale: "no",
    recipientName: null,
    titles,
    link: "https://x.test",
    unsubscribeLink: "https://x.test/u",
  });
  assert.match(built.text, /riktig kontakt|peke oss/i);
});

test("falls back to English when locale template missing", () => {
  const built = buildOutreachEmail({
    step: "initial",
    locale: "fr" as any, // unknown locale
    recipientName: null,
    titles,
    link: "https://x.test",
    unsubscribeLink: "https://x.test/u",
  });
  assert.match(built.subject, /Native|rate card/i);
});

test("renders 'and N more' when title list > 8", () => {
  const many = Array.from({ length: 12 }, (_, i) => ({ name: `Title ${i + 1}`, marketCode: "NO" as const }));
  const built = buildOutreachEmail({
    step: "initial",
    locale: "no",
    recipientName: null,
    titles: many,
    link: "https://x.test",
    unsubscribeLink: "https://x.test/u",
  });
  assert.match(built.text, /og \d+ til/);
});
