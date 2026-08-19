import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "node:crypto";

export const RATE_CARD_TYPES: ReadonlySet<string> = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.ms-powerpoint",
  "image/png",
  "image/jpeg",
]);

export const ARTICLE_TYPES: ReadonlySet<string> = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
]);

const MAX_BYTES = 25 * 1024 * 1024;

export function validateContentType(
  ct: string,
  allowedTypes: ReadonlySet<string> = RATE_CARD_TYPES,
): boolean {
  return allowedTypes.has(ct.toLowerCase());
}

export function isAllowedSize(bytes: number): boolean {
  return bytes > 0 && bytes <= MAX_BYTES;
}

export function buildObjectKey(args: { prefix: string; filename: string }): string {
  const date = new Date().toISOString().slice(0, 10);
  const uuid = randomUUID();
  const safe = args.filename
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/\.+/g, ".")          // collapse multiple dots (drops .. traversal)
    .replace(/^[-.]+|[-.]+$/g, "");  // trim leading/trailing -.
  if (!safe) throw new Error(`filename_sanitises_to_empty:${args.filename}`);
  return `${args.prefix}/${date}/${uuid}-${safe}`;
}

let _client: S3Client | null = null;
function client(): S3Client {
  if (_client) return _client;
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!accountId) throw new Error("R2_ACCOUNT_ID not set");
  if (!accessKeyId) throw new Error("R2_ACCESS_KEY_ID not set");
  if (!secretAccessKey) throw new Error("R2_SECRET_ACCESS_KEY not set");
  _client = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
  return _client;
}

function bucket(): string {
  const b = process.env.R2_BUCKET;
  if (!b) throw new Error("R2_BUCKET not set");
  return b;
}

export async function presignUpload(args: {
  prefix: string;
  filename: string;
  contentType: string;
  bytes: number;
  ttlSec?: number;
  allowedTypes?: ReadonlySet<string>;
}): Promise<{ url: string; key: string }> {
  if (!validateContentType(args.contentType, args.allowedTypes)) {
    throw new Error(`content_type_not_allowed:${args.contentType}`);
  }
  if (!isAllowedSize(args.bytes)) {
    throw new Error(`file_size_not_allowed:${args.bytes}`);
  }
  const key = buildObjectKey({ prefix: args.prefix, filename: args.filename });
  const cmd = new PutObjectCommand({
    Bucket: bucket(),
    Key: key,
    ContentType: args.contentType,
    ContentLength: args.bytes,
  });
  const url = await getSignedUrl(client(), cmd, { expiresIn: args.ttlSec ?? 300 });
  return { url, key };
}

export async function presignDownload(args: { key: string; ttlSec?: number }): Promise<string> {
  const cmd = new GetObjectCommand({ Bucket: bucket(), Key: args.key });
  return getSignedUrl(client(), cmd, { expiresIn: args.ttlSec ?? 3600 });
}

// Render-path variant: a page that merely *offers* a download must not
// 500 because R2 credentials are missing (local dev, preview) or the
// signer is unavailable. Callers render no link when this returns null.
export async function presignDownloadOrNull(args: {
  key: string;
  ttlSec?: number;
}): Promise<string | null> {
  try {
    return await presignDownload(args);
  } catch (error) {
    console.error("presign_download_failed", args.key, error);
    return null;
  }
}

// Server-side direct upload. Used when the bytes already live on the
// server (e.g. a PDF pulled from an email reply / forwarded inbox)
// rather than coming from a browser via a presigned PUT. Same client,
// bucket and content-type/size validation as the presigned path.
export async function putObject(args: {
  prefix: string;
  filename: string;
  contentType: string;
  body: Buffer;
  allowedTypes?: ReadonlySet<string>;
}): Promise<{ key: string; sizeBytes: number }> {
  if (!validateContentType(args.contentType, args.allowedTypes)) {
    throw new Error(`content_type_not_allowed:${args.contentType}`);
  }
  if (!isAllowedSize(args.body.byteLength)) {
    throw new Error(`file_size_not_allowed:${args.body.byteLength}`);
  }
  const key = buildObjectKey({ prefix: args.prefix, filename: args.filename });
  await client().send(
    new PutObjectCommand({
      Bucket: bucket(),
      Key: key,
      Body: args.body,
      ContentType: args.contentType,
      ContentLength: args.body.byteLength,
    }),
  );
  return { key, sizeBytes: args.body.byteLength };
}
