/** Upload the 2026-06-10 reply-wave mediekits/proposals to R2 + RateCardDocument rows.
 * Files staged under docs/outreach-sources/_dl-0610/. Idempotent by fileName; stores
 * pdftotext as ocrText. R2-only (not git).
 * Run: railway run --service Native sh -c 'DATABASE_URL="<public>" pnpm tsx scripts/upload-ratecards-r2-0610.ts' */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { buildObjectKey } from "@/lib/storage/r2";
import { prisma } from "@/lib/prisma";

const ACTOR = "cmpmdiqtg048c0hu080m8kmok";
const ROOT = join(process.cwd(), "docs/outreach-sources/_dl-0610");
const SRC = "email:";

type Doc = { file: string; slug?: string; publisher?: string; source: string };
const DOCS: Doc[] = [
  { file: "akersposten/AOL_Akerposten_Admirate.xlsx - Proposal.pdf", slug: "akersposten-no", source: SRC + "henriette.kjernes@amedia.no" },
  { file: "mediakraft/Fysioterapi2026.pdf", slug: "fysioterapi-se", source: SRC + "gabrielle.hagman@mediakraft.se" },
  { file: "mediakraft/Hem&Hyra2026.pdf", slug: "hem-hyra-se", source: SRC + "gabrielle.hagman@mediakraft.se" },
  { file: "gartner-tidende/Medieplan2026_DK.pdf", slug: "gartner-tidende-dk", source: SRC + "ksv@hortiadvice.dk" },
  { file: "aller-dk/Aller Media BRAND Præsentation 2026 - DK.pdf", publisher: "Aller Media (DK)", source: SRC + "casper.konig-fonberg@aller.com" },
];

function s3() {
  const accountId = process.env.R2_ACCOUNT_ID, accessKeyId = process.env.R2_ACCESS_KEY_ID, secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!accountId || !accessKeyId || !secretAccessKey) throw new Error("R2 creds not in env (run under --service Native)");
  return new S3Client({ region: "auto", endpoint: `https://${accountId}.r2.cloudflarestorage.com`, credentials: { accessKeyId, secretAccessKey } });
}
function ocr(path: string): { text: string | null; status: "DONE" | "FAILED" } {
  try { return { text: execFileSync("pdftotext", ["-layout", path, "-"], { maxBuffer: 20e6 }).toString().slice(0, 100000), status: "DONE" }; }
  catch { return { text: null, status: "FAILED" }; }
}

async function main() {
  const bucket = process.env.R2_BUCKET; if (!bucket) throw new Error("R2_BUCKET not set");
  const client = s3();
  const existing = new Set((await prisma.rateCardDocument.findMany({ select: { fileName: true } })).map((d) => d.fileName));
  for (const d of DOCS) {
    const fileName = d.file.split("/").pop()!;
    if (existing.has(fileName)) { console.log(`skip (already): ${fileName}`); continue; }
    let body: Buffer; const abs = join(ROOT, d.file);
    try { body = readFileSync(abs); } catch { console.log(`! missing on disk: ${d.file}`); continue; }
    const title = d.slug ? await prisma.title.findFirst({ where: { slug: d.slug }, select: { id: true } }) : null;
    const publisher = d.publisher ? await prisma.publisher.findFirst({ where: { name: d.publisher }, select: { id: true } }) : null;
    if (d.slug && !title) console.log(`  ~ title not found (${d.slug}) — uploading unlinked`);
    const key = buildObjectKey({ prefix: "rate-cards", filename: fileName });
    await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: "application/pdf", ContentLength: body.byteLength }));
    const { text, status } = ocr(abs);
    await prisma.rateCardDocument.create({ data: { titleId: title?.id ?? null, publisherId: publisher?.id ?? null, fileName, objectKey: key, contentType: "application/pdf", sizeBytes: body.byteLength, ocrText: text ?? undefined, ocrStatus: status, source: d.source, createdById: ACTOR } });
    console.log(`↑ ${fileName} → ${key} (${(body.byteLength / 1e6).toFixed(1)} MB)${title ? "" : publisher ? " [pub]" : " [unlinked]"}${text ? " +ocr" : ""}`);
  }
  await prisma.$disconnect();
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
