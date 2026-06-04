import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { putObject, presignDownload } from "@/lib/storage/r2";
import type { RateCardDocument } from "@prisma/client";

const PREFIX = "rate-cards";

export type StoreRateCardArgs = {
  buffer: Buffer;
  fileName: string;
  contentType?: string;
  titleId?: string;
  publisherId?: string;
  contactLogId?: string;
  source?: string;
  actorId: string;
};

// Ingest a received rate-card / media-kit file: put the original in R2
// (history is never lost) and create a RateCardDocument row in PENDING
// OCR status. OCR + structured extraction run as later, non-blocking
// steps keyed off this row. Audited.
export async function storeRateCardDocument(
  args: StoreRateCardArgs,
): Promise<RateCardDocument> {
  const contentType = args.contentType ?? "application/pdf";

  const { key, sizeBytes } = await putObject({
    prefix: PREFIX,
    filename: args.fileName,
    contentType,
    body: args.buffer,
  });

  const doc = await prisma.rateCardDocument.create({
    data: {
      titleId: args.titleId ?? null,
      publisherId: args.publisherId ?? null,
      contactLogId: args.contactLogId ?? null,
      fileName: args.fileName,
      objectKey: key,
      contentType,
      sizeBytes,
      ocrStatus: "PENDING",
      source: args.source ?? null,
      createdById: args.actorId,
    },
  });

  await recordAudit(args.actorId, "rate_card_document.store", `RateCardDocument:${doc.id}`, {
    titleId: args.titleId,
    publisherId: args.publisherId,
    contactLogId: args.contactLogId,
    fileName: args.fileName,
    objectKey: key,
    sizeBytes,
    source: args.source,
  });

  return doc;
}

// Persist the OCR result for a stored document. Best-effort callers set
// status FAILED with whatever (possibly empty) text they recovered.
export async function setRateCardOcr(args: {
  id: string;
  ocrText: string;
  ocrStatus: "DONE" | "FAILED";
  actorId: string;
}): Promise<RateCardDocument> {
  const doc = await prisma.rateCardDocument.update({
    where: { id: args.id },
    data: { ocrText: args.ocrText, ocrStatus: args.ocrStatus },
  });
  await recordAudit(args.actorId, "rate_card_document.ocr", `RateCardDocument:${doc.id}`, {
    ocrStatus: args.ocrStatus,
    chars: args.ocrText.length,
  });
  return doc;
}

// Short-lived signed URL to view/download the original object from R2.
export function rateCardDownloadUrl(objectKey: string, ttlSec?: number): Promise<string> {
  return presignDownload({ key: objectKey, ttlSec });
}
