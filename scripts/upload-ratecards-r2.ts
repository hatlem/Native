/** Upload outreach mediekit/rate-card PDFs to R2 + create RateCardDocument rows.
 * Backups live in R2 (bucket nativespin-blob, prefix rate-cards/<date>/...), linked
 * in the DB — NOT in git. Idempotent: skips any file whose fileName already has a row.
 * Run: railway run --service Native sh -c 'DATABASE_URL="<public>" pnpm tsx scripts/upload-ratecards-r2.ts' */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { buildObjectKey } from "@/lib/storage/r2";
import { prisma } from "@/lib/prisma";

const ACTOR = "cmpmdiqtg048c0hu080m8kmok";
const ROOT = join(process.cwd(), "docs/outreach-sources");
const SRC = "email:";

type Doc = { file: string; title?: string; cc?: string; publisher?: string; source: string };
const DOCS: Doc[] = [
  { file: "aller/Alla varumarken - Aller 2026.pdf", title: "Allas", cc: "SE", publisher: "Aller Media (SE)", source: SRC + "camilla.hedstrom@aller.com" },
  { file: "aller/Aller Native 2026.pdf", title: "Allas", cc: "SE", publisher: "Aller Media (SE)", source: SRC + "camilla.hedstrom@aller.com" },
  { file: "amedia/Innholdsmarkedsføring - Amedia x Admirate Performance.pdf", title: "Fanaposten", cc: "NO", source: "campaign:admirate-2026-06-08 (Miriam Olaussen, Amedia Annonse Vest)" },
  { file: "arkitektur/Arkitektur medieplan 2026.pdf", title: "Arkitektur", cc: "NO", source: "campaign:admirate-2026-06-08 (Anita Lindberg, HS Media)" },
  { file: "arkitektur/Arkitektur.no mediaplan digitalt 2026.pdf", title: "Arkitektur", cc: "NO", source: "campaign:admirate-2026-06-08 (Anita Lindberg, HS Media)" },
  { file: "batliv_se/Båtliv_2026.pdf", title: "Båtliv", cc: "SE", source: "campaign:admirate-2026-06-05 (Henrik Salén, Marina Media)" },
  { file: "bonnier-fi/BNF ELIN .pdf", title: "Hufvudstadsbladet", cc: "FI", source: "campaign:admirate-2026-06-08 (Elin Karppinen, Bonnier News B2B FI)" },
  { file: "bonnier-healthcare/Copy of BHN Media Kit 2026 NO.pdf", title: "Dagens Medisin", cc: "NO", source: SRC + "arvid.ervik@bonniernews.no" },
  { file: "edda-aksess/AKSESS 1+2 2026_justert.pdf", title: "Aksess", cc: "NO", source: "campaign:admirate-2026-06-05 (Sissel Bjerkeset, Edda Presse)" },
  { file: "finans/FA Brandstudio muligheter  2026   (1).pdf", title: "Finansavisen", cc: "NO", source: "campaign:admirate-2026-06-08 (FA Brand Studio)" },
  { file: "jakt/Mediafakta_Allt om Jakt & Vapen_2026_A4.pdf", title: "Allt om Jakt & Vapen", cc: "SE", source: SRC + "sofie@joforlaget.se" },
  { file: "nmf/Mediakit_NMF_UK_2026.pdf", title: "Båtmagasinet", cc: "NO", source: "campaign:admirate-2026-06-08 (Håkon Nissen-Lie, NMF)" },
  { file: "oyblikk/Priser2026.pdf", title: "Øy-Blikk", cc: "NO", source: "campaign:admirate-2026-06-08" },
  { file: "oyblikk/NettPriser2026.pdf", title: "Øy-Blikk", cc: "NO", source: "campaign:admirate-2026-06-08" },
  { file: "schibsted/Skjermbilde 2026-06-08 kl. 14.23.18.png", title: "E24", cc: "NO", source: SRC + "andreas.askheim@schibsted.com" },
  { file: "vestavind/vestavind_modulkart og prisar 2026.pdf", title: "Vestavind", cc: "NO", source: "campaign:admirate-2026-06-08" },
  { file: "vestnesavisa/Annonseprisar Vestnesavisa 2025.pdf", title: "Vestnesavisa", cc: "NO", source: SRC + "sh@tvisyn.media" },
];

function s3() {
  const accountId = process.env.R2_ACCOUNT_ID, accessKeyId = process.env.R2_ACCESS_KEY_ID, secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!accountId || !accessKeyId || !secretAccessKey) throw new Error("R2 creds not in env (run under --service Native)");
  return new S3Client({ region: "auto", endpoint: `https://${accountId}.r2.cloudflarestorage.com`, credentials: { accessKeyId, secretAccessKey } });
}

async function main() {
  const bucket = process.env.R2_BUCKET;
  if (!bucket) throw new Error("R2_BUCKET not set");
  const client = s3();
  const existing = new Set((await prisma.rateCardDocument.findMany({ select: { fileName: true } })).map((d) => d.fileName));

  for (const d of DOCS) {
    const fileName = d.file.split("/").pop()!;
    if (existing.has(fileName)) { console.log(`skip (already in R2): ${fileName}`); continue; }
    const contentType = fileName.toLowerCase().endsWith(".png") ? "image/png" : "application/pdf";
    let body: Buffer;
    try { body = readFileSync(join(ROOT, d.file)); } catch { console.log(`! missing on disk: ${d.file}`); continue; }

    const title = d.title ? await prisma.title.findFirst({ where: { name: { equals: d.title, mode: "insensitive" }, ...(d.cc ? { countryCode: d.cc } : {}) }, select: { id: true } }) : null;
    const publisher = d.publisher ? await prisma.publisher.findFirst({ where: { name: d.publisher }, select: { id: true } }) : null;
    if (d.title && !title) console.log(`  ~ title not found (${d.title}/${d.cc}) — uploading unlinked`);

    const key = buildObjectKey({ prefix: "rate-cards", filename: fileName });
    await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType, ContentLength: body.byteLength }));
    await prisma.rateCardDocument.create({ data: {
      titleId: title?.id ?? null, publisherId: publisher?.id ?? null, fileName, objectKey: key, contentType,
      sizeBytes: body.byteLength, ocrStatus: "PENDING", source: d.source, createdById: ACTOR,
    } });
    console.log(`↑ ${fileName} → ${key} (${(body.byteLength / 1e6).toFixed(1)} MB)${title ? "" : " [unlinked]"}`);
  }
  await prisma.$disconnect();
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
