/** Upload the 2026-06-09 reply-wave mediekits/rate-cards to R2 + RateCardDocument rows.
 * Files staged under docs/outreach-sources/_dl-0609/. Idempotent by fileName. Stores
 * pdftotext output as ocrText so the docs are searchable. NOT committed to git (R2 only).
 * Run: railway run --service Native sh -c 'DATABASE_URL="<public>" pnpm tsx scripts/upload-ratecards-r2-0609.ts' */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { buildObjectKey } from "@/lib/storage/r2";
import { prisma } from "@/lib/prisma";

const ACTOR = "cmpmdiqtg048c0hu080m8kmok";
const ROOT = join(process.cwd(), "docs/outreach-sources/_dl-0609");
const SRC = "email:";

type Doc = { file: string; title?: string; slug?: string; cc?: string; publisher?: string; source: string };
const DOCS: Doc[] = [
  // Läkartidningen (David Andreasson)
  { file: "lakartidningen/LT_nativeannonsering_2025.pdf", slug: "la-kartidningen-se", source: SRC + "david@informa.se" },
  { file: "lakartidningen/LT_praktikertjanst_native_helsida_utf_202209-10.pdf", slug: "la-kartidningen-se", source: SRC + "david@informa.se" },
  { file: "lakartidningen/Online_2026.pdf", slug: "la-kartidningen-se", source: SRC + "david@informa.se" },
  { file: "lakartidningen/Produktannonser_2026.pdf", slug: "la-kartidningen-se", source: SRC + "david@informa.se" },
  // Världen Idag (Johanna Köllerfors)
  { file: "varldenidag/NativeAdv_Web_johanna.pdf", slug: "va-rlden-idag-se", source: SRC + "annons@varldenidag.se" },
  // Bonnier idenyt (Michael Nielsen)
  { file: "bonnier/Admirate_Bonnier_Idenyt.pdf", slug: "idenyt-dk", source: SRC + "michael.nielsen@bonnier.dk" },
  // Media-Partners (Hanne Kjærgaard)
  { file: "media-partners/BIOANALYTIKEREN_Mediekit 2026.pdf", slug: "bioanalytikeren-dk", source: SRC + "hanne@media-partners.dk" },
  { file: "media-partners/Sygeplejersken_mediekit2026.pdf", slug: "sygeplejersken-dk", source: SRC + "hanne@media-partners.dk" },
  { file: "media-partners/Banner placeringer_DSR.pdf", slug: "sygeplejersken-dk", source: SRC + "hanne@media-partners.dk" },
  { file: "media-partners/Pharma_mediekit_2026.pdf", slug: "pharma-dk", source: SRC + "hanne@media-partners.dk" },
  { file: "media-partners/Farmaci_mediekit_2026.pdf", slug: "farmaci-dk", source: SRC + "hanne@media-partners.dk" },
  { file: "media-partners/Lægeliv_mediekit_2026.pdf", slug: "magasinet-laegeliv-dk", source: SRC + "hanne@media-partners.dk" },
  // Story House Egmont (Thomas Sedin)
  { file: "egmont/Prishuppgifter Story House Egmont 2026.xlsx", publisher: "Egmont (SE)", source: SRC + "thomas.sedin@egmont.se" },
  { file: "egmont/Hus & Hem Mediafakta 2026.pdf", slug: "hus-hem-se", source: SRC + "thomas.sedin@egmont.se" },
  { file: "egmont/Icakuriren Mediafakta 2026.pdf", slug: "icakuriren-se", source: SRC + "thomas.sedin@egmont.se" },
  { file: "egmont/Hemmets Journal Mediafakta 2026.pdf", slug: "hemmets-journal-se", source: SRC + "thomas.sedin@egmont.se" },
  // Proffs / Vägpress (Pekka Tikkanen)
  { file: "proffs/annonsprislista 2026.pdf", slug: "proffs-se", source: SRC + "annons@vagpress.se" },
  { file: "proffs/Proffs 2025.pdf", slug: "proffs-se", source: SRC + "annons@vagpress.se" },
];

function s3() {
  const accountId = process.env.R2_ACCOUNT_ID, accessKeyId = process.env.R2_ACCESS_KEY_ID, secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!accountId || !accessKeyId || !secretAccessKey) throw new Error("R2 creds not in env (run under --service Native)");
  return new S3Client({ region: "auto", endpoint: `https://${accountId}.r2.cloudflarestorage.com`, credentials: { accessKeyId, secretAccessKey } });
}
function ocr(path: string): { text: string | null; status: "DONE" | "FAILED" } {
  if (!path.toLowerCase().endsWith(".pdf")) return { text: null, status: "FAILED" };
  try { return { text: execFileSync("pdftotext", ["-layout", path, "-"], { maxBuffer: 20e6 }).toString().slice(0, 100000), status: "DONE" }; }
  catch { return { text: null, status: "FAILED" }; }
}

async function main() {
  const bucket = process.env.R2_BUCKET;
  if (!bucket) throw new Error("R2_BUCKET not set");
  const client = s3();
  const existing = new Set((await prisma.rateCardDocument.findMany({ select: { fileName: true } })).map((d) => d.fileName));

  for (const d of DOCS) {
    const fileName = d.file.split("/").pop()!;
    if (existing.has(fileName)) { console.log(`skip (already): ${fileName}`); continue; }
    const isXlsx = fileName.toLowerCase().endsWith(".xlsx");
    const contentType = isXlsx ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "application/pdf";
    let body: Buffer;
    const abs = join(ROOT, d.file);
    try { body = readFileSync(abs); } catch { console.log(`! missing on disk: ${d.file}`); continue; }

    const title = d.slug ? await prisma.title.findFirst({ where: { slug: d.slug }, select: { id: true } })
      : d.title ? await prisma.title.findFirst({ where: { name: { equals: d.title, mode: "insensitive" }, ...(d.cc ? { countryCode: d.cc } : {}) }, select: { id: true } }) : null;
    const publisher = d.publisher ? await prisma.publisher.findFirst({ where: { name: d.publisher }, select: { id: true } }) : null;
    if ((d.slug || d.title) && !title) console.log(`  ~ title not found (${d.slug ?? d.title}) — uploading unlinked`);

    const key = buildObjectKey({ prefix: "rate-cards", filename: fileName });
    await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType, ContentLength: body.byteLength }));
    const { text, status } = isXlsx ? { text: null, status: "PENDING" as const } : ocr(abs);
    await prisma.rateCardDocument.create({ data: {
      titleId: title?.id ?? null, publisherId: publisher?.id ?? null, fileName, objectKey: key, contentType,
      sizeBytes: body.byteLength, ocrText: text ?? undefined, ocrStatus: status as "DONE" | "FAILED" | "PENDING", source: d.source, createdById: ACTOR,
    } });
    console.log(`↑ ${fileName} → ${key} (${(body.byteLength / 1e6).toFixed(1)} MB)${title ? "" : " [unlinked]"}${text ? " +ocr" : ""}`);
  }
  await prisma.$disconnect();
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
