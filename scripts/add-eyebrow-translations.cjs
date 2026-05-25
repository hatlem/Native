#!/usr/bin/env node
// Patch missing eyebrow keys added when the marketing pages were polished
// to use section-head with eyebrow + title. Idempotent.

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

const PATCH = {
  en: {
    pricing: { feesEyebrow: "Fees", faqEyebrow: "FAQ" },
    security: { pillarsEyebrow: "Principles", complianceEyebrow: "Compliance" },
  },
  no: {
    pricing: { feesEyebrow: "Avgifter", faqEyebrow: "Ofte stilte spørsmål" },
    security: { pillarsEyebrow: "Prinsipper", complianceEyebrow: "Compliance" },
  },
  sv: {
    pricing: { feesEyebrow: "Avgifter", faqEyebrow: "Vanliga frågor" },
    security: { pillarsEyebrow: "Principer", complianceEyebrow: "Compliance" },
  },
  da: {
    pricing: { feesEyebrow: "Gebyrer", faqEyebrow: "Ofte stillede spørgsmål" },
    security: { pillarsEyebrow: "Principper", complianceEyebrow: "Compliance" },
  },
};

let total = 0;
for (const [locale, namespaces] of Object.entries(PATCH)) {
  const file = path.join(ROOT, "src/messages", `${locale}.json`);
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  let added = 0;
  for (const [ns, keys] of Object.entries(namespaces)) {
    if (!data[ns]) continue;
    for (const [k, v] of Object.entries(keys)) {
      if (k in data[ns]) continue;
      data[ns][k] = v;
      added++;
    }
  }
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n", "utf8");
  console.log(`${locale}: +${added}`);
  total += added;
}
console.log(`total: +${total}`);
