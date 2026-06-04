// Rate-card OCR. Two-stage, best-effort text extraction from a PDF:
//
//   1. Digital text via pdf-parse `getText` — covers most modern media
//      kits (text is selectable).
//   2. Image OCR — many publishers ship prices baked into image/vector
//      layouts where step 1 sees nothing. We rasterise each page with
//      pdf-parse `getScreenshot` (it bundles @napi-rs/canvas, so this
//      works headless in Node) and run tesseract.js over the page
//      images. Rendered images are NEVER stored — only the recognised
//      text is returned.
//
// Everything is best-effort: any stage may throw (corrupt PDF, OCR
// engine failure) and we still return whatever text we managed to get,
// so OCR can never block ingestion. The caller decides DONE vs FAILED.

import { PDFParse } from "pdf-parse";

// Default OCR languages. Media kits in our markets are mostly Nordic +
// German + English; tesseract.js fetches the trained-data on demand.
const OCR_LANGS = "eng+nor+swe+dan+fin+deu";
// Cap rasterised pages so a 60-page brochure can't pin the worker for
// minutes. Prices live up front in practically every media kit.
const MAX_OCR_PAGES = 12;
// 2x device scale → sharp enough for small rate-card type without
// blowing up memory.
const RENDER_SCALE = 2;

export type OcrResult = {
  text: string;
  digitalChars: number;
  ocrChars: number;
  pagesOcred: number;
};

// Extract digital (selectable) text from the PDF. Empty string on
// failure.
async function extractDigitalText(buffer: Buffer): Promise<string> {
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const res = await parser.getText();
    return (res.text ?? "").trim();
  } catch (err) {
    console.error("ratecard.ocr.digital_failed", err);
    return "";
  } finally {
    await parser.destroy?.().catch(() => {});
  }
}

// Rasterise up to MAX_OCR_PAGES pages and OCR them. Returns recognised
// text per page joined by form-feeds. Empty string on any failure.
async function extractImageOcr(buffer: Buffer): Promise<{ text: string; pages: number }> {
  let pageImages: Buffer[] = [];

  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const shot = await parser.getScreenshot({ imageBuffer: true, scale: RENDER_SCALE });
    pageImages = shot.pages
      .slice(0, MAX_OCR_PAGES)
      .filter((p) => p.data && p.data.length > 0)
      .map((p) => Buffer.from(p.data));
  } catch (err) {
    console.error("ratecard.ocr.rasterise_failed", err);
    return { text: "", pages: 0 };
  } finally {
    await parser.destroy?.().catch(() => {});
  }

  if (pageImages.length === 0) return { text: "", pages: 0 };

  // tesseract.js is dynamically imported so the (heavy) worker is only
  // pulled in when image OCR actually runs.
  let worker: Awaited<ReturnType<typeof import("tesseract.js").createWorker>> | null = null;
  try {
    const { createWorker } = await import("tesseract.js");
    worker = await createWorker(OCR_LANGS);
    const parts: string[] = [];
    for (const img of pageImages) {
      try {
        const { data } = await worker.recognize(img);
        const t = (data.text ?? "").trim();
        if (t) parts.push(t);
      } catch (err) {
        console.error("ratecard.ocr.page_failed", err);
      }
    }
    return { text: parts.join("\n\f\n"), pages: pageImages.length };
  } catch (err) {
    console.error("ratecard.ocr.engine_failed", err);
    return { text: "", pages: 0 };
  } finally {
    await worker?.terminate().catch(() => {});
  }
}

// Combined digital + image OCR. Best-effort: never throws; returns the
// union of whatever text both stages recovered. The two stages overlap
// (a digital page also gets rasterised), which is fine — extraction
// downstream is regex/heuristic and dedupes by meaning, not by line.
export async function ocrPdf(buffer: Buffer): Promise<string> {
  const result = await ocrPdfDetailed(buffer);
  return result.text;
}

// Same as `ocrPdf` but returns extraction stats too — handy for the
// desk panel / audit and for deciding DONE vs FAILED.
export async function ocrPdfDetailed(buffer: Buffer): Promise<OcrResult> {
  const [digital, image] = await Promise.all([
    extractDigitalText(buffer),
    extractImageOcr(buffer),
  ]);

  const sections: string[] = [];
  if (digital) sections.push(digital);
  if (image.text) sections.push(`--- OCR (image text) ---\n${image.text}`);

  return {
    text: sections.join("\n\n").trim(),
    digitalChars: digital.length,
    ocrChars: image.text.length,
    pagesOcred: image.pages,
  };
}
