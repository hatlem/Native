// Idempotent ops script: insert a few starter content playbooks so the
// feature ships with useful defaults. Skips if any playbook already exists
// (never clobbers desk edits). Generic native best-practice — the desk
// refines per format/category/market in /desk/playbooks.
//
//   pnpm tsx scripts/seed-playbooks.ts

import { PrismaClient, ProductType } from "@prisma/client";

const prisma = new PrismaClient();

const STARTERS = [
  {
    productType: null,
    category: null,
    marketCode: null,
    title: "Native that reads like editorial",
    angle: "Lead with the reader's problem, not the brand. Earn the read first; the brand pays off at the end.",
    structure: "Hook (a real tension) → context → a genuinely useful insight → soft brand resolution → clear next step.",
    doList: [
      "Match the title's voice and sentence rhythm",
      "Cite concrete data or a real example",
      "Make the first paragraph stand on its own",
    ].join("\n"),
    dontList: [
      "Open with the brand or the product name",
      "Use ad language (\"leading\", \"best-in-class\", \"revolutionary\")",
      "Bury the reader value below the fold",
    ].join("\n"),
    exampleHeadlines: [
      "What most [audience] get wrong about [topic]",
      "The quiet shift reshaping [industry]",
      "We analysed [N] [things]. Here's what held up.",
    ].join("\n"),
  },
  {
    productType: ProductType.ADVERTORIAL,
    category: null,
    marketCode: null,
    title: "Advertorial — disclosure-forward",
    angle: "The label is up front and unembarrassed; the value still carries the piece.",
    structure: "Clear sponsored label → reader-useful body → honest brand role → CTA.",
    doList: ["Place the disclosure label before the headline", "Keep claims substantiated"].join("\n"),
    dontList: ["Disguise it as unmarked editorial", "Over-claim to compensate for the label"].join("\n"),
    exampleHeadlines: ["[Brand] explains: how [outcome] actually works"].join("\n"),
  },
  {
    productType: ProductType.NATIVE_ARTICLE,
    category: "business",
    marketCode: null,
    title: "Business native — decision-maker angle",
    angle: "Speak to the cost of inaction and the trade-off the reader is actually weighing.",
    structure: "Trend/threat → what it changes for the reader's role → framework → where the brand fits.",
    doList: ["Quantify impact", "Name the reader's role explicitly"].join("\n"),
    dontList: ["Generic thought-leadership filler", "Feature lists"].join("\n"),
    exampleHeadlines: ["The [metric] every [role] should be watching in 2026"].join("\n"),
  },
];

async function main() {
  const existing = await prisma.playbook.count();
  if (existing > 0) {
    console.log(`Playbook already has ${existing} rows — skipping.`);
    return;
  }
  await prisma.playbook.createMany({ data: STARTERS });
  console.log(`Inserted ${STARTERS.length} starter playbooks.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
