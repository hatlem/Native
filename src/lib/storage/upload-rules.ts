// What a browser upload may be — pure, with no storage SDK import, so the
// upload forms can check a file BEFORE asking the server for a URL and tell
// the user exactly what is wrong with it. The server (r2.ts) enforces the
// same rules; this module is the single definition both sides use.

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

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export function validateContentType(
  ct: string,
  allowedTypes: ReadonlySet<string> = RATE_CARD_TYPES,
): boolean {
  return allowedTypes.has(ct.toLowerCase());
}

export function isAllowedSize(bytes: number): boolean {
  return bytes > 0 && bytes <= MAX_UPLOAD_BYTES;
}

// Why an upload can't go ahead, as the forms word it:
//   file-type            — not one of the accepted formats
//   file-size            — empty, or over 25 MB
//   storage-unavailable  — our storage isn't configured; no file would work
//   upload-failed        — the transfer itself failed (network, expired URL)
export type UploadProblem = "file-type" | "file-size" | "storage-unavailable" | "upload-failed";

/** The file's own problem, if any (type first — a wrong type is the likelier
 *  mistake and the more useful message). */
export function fileProblem(
  file: { type: string; size: number },
  allowedTypes: ReadonlySet<string>,
): Extract<UploadProblem, "file-type" | "file-size"> | null {
  if (!validateContentType(file.type, allowedTypes)) return "file-type";
  if (!isAllowedSize(file.size)) return "file-size";
  return null;
}
