import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "node:crypto";
import {
  fileProblem,
  isAllowedSize,
  validateContentType,
  RATE_CARD_TYPES,
  type UploadProblem,
} from "./upload-rules";

// The upload rules live in upload-rules.ts (no SDK import, so the browser
// forms can use them too); re-exported for existing server-side imports.
export {
  ARTICLE_TYPES,
  RATE_CARD_TYPES,
  isAllowedSize,
  validateContentType,
} from "./upload-rules";

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

const R2_ENV_VARS = [
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET",
] as const;

// Thrown by every storage call when R2 credentials are missing (local dev,
// previews, a misconfigured deploy). A distinct type so callers can turn it
// into a clear "storage isn't configured" message instead of a 500.
export class StorageNotConfiguredError extends Error {
  constructor(readonly missing: readonly string[]) {
    super(`Object storage not configured (missing ${missing.join(", ")})`);
    this.name = "StorageNotConfiguredError";
  }
}

export function missingStorageEnv(
  env: Record<string, string | undefined> = process.env,
): string[] {
  return R2_ENV_VARS.filter((k) => !env[k]);
}

// Cheap upfront check, so an action can refuse before doing expensive work
// (e.g. rendering a PDF) that could never be saved.
export function isStorageConfigured(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return missingStorageEnv(env).length === 0;
}

function assertConfigured(): void {
  const missing = missingStorageEnv();
  if (missing.length > 0) throw new StorageNotConfiguredError(missing);
}

let _client: S3Client | null = null;
function client(): S3Client {
  if (_client) return _client;
  assertConfigured();
  _client = new S3Client({
    region: "auto",
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID as string,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY as string,
    },
  });
  return _client;
}

function bucket(): string {
  assertConfigured();
  return process.env.R2_BUCKET as string;
}

// Result shape for browser-initiated uploads. Server-action errors reach the
// client as a generic message in production, so an expected condition like
// "storage isn't configured" has to travel as data for the UI to explain it.
export type PresignUploadResult =
  | { ok: true; url: string; key: string }
  | { ok: false; reason: Exclude<UploadProblem, "upload-failed"> };

// presignUpload, with every expected refusal reported as a result instead of
// thrown: missing configuration, and a file of the wrong type or size. The
// file checks used to throw, and a thrown server-action error reaches the
// browser as a generic message — the form could only say "Upload failed.
// Try a different file." whatever the cause (or, on the rate-card form, show
// the raw error code).
export async function presignUploadResult(
  args: Parameters<typeof presignUpload>[0],
): Promise<PresignUploadResult> {
  const problem = fileProblem(
    { type: args.contentType, size: args.bytes },
    args.allowedTypes ?? RATE_CARD_TYPES,
  );
  if (problem) return { ok: false, reason: problem };
  if (!isStorageConfigured()) {
    console.error("storage.not_configured", { missing: missingStorageEnv(), prefix: args.prefix });
    return { ok: false, reason: "storage-unavailable" };
  }
  const { url, key } = await presignUpload(args);
  return { ok: true, url, key };
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
