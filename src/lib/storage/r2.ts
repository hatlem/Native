import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "node:crypto";

const ALLOWED_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.ms-powerpoint",
  "image/png",
  "image/jpeg",
]);
const MAX_BYTES = 25 * 1024 * 1024;

export function validateContentType(ct: string): boolean {
  return ALLOWED_TYPES.has(ct.toLowerCase());
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
  return `${args.prefix}/${date}/${uuid}-${safe}`;
}

let _client: S3Client | null = null;
function client(): S3Client {
  if (_client) return _client;
  const accountId = process.env.R2_ACCOUNT_ID;
  if (!accountId) throw new Error("R2_ACCOUNT_ID not set");
  _client = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
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
  ttlSec?: number;
}): Promise<{ url: string; key: string }> {
  if (!validateContentType(args.contentType)) {
    throw new Error(`content_type_not_allowed:${args.contentType}`);
  }
  const key = buildObjectKey({ prefix: args.prefix, filename: args.filename });
  const cmd = new PutObjectCommand({
    Bucket: bucket(),
    Key: key,
    ContentType: args.contentType,
  });
  const url = await getSignedUrl(client(), cmd, { expiresIn: args.ttlSec ?? 300 });
  return { url, key };
}

export async function presignDownload(args: { key: string; ttlSec?: number }): Promise<string> {
  const cmd = new GetObjectCommand({ Bucket: bucket(), Key: args.key });
  return getSignedUrl(client(), cmd, { expiresIn: args.ttlSec ?? 3600 });
}
