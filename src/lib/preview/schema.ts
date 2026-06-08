import { z } from "zod";

export const MARKET_CODES = ["NO", "SE", "DK", "FI", "DE", "AT", "CH", "UK", "IE"] as const;
export type MarketCode = (typeof MARKET_CODES)[number];

export const TONES = ["warm", "investigative", "aspirational", "plain"] as const;
export type Tone = (typeof TONES)[number];

export interface PreviewInput {
  brand: string;
  product: string;
  market: MarketCode;
  tone: Tone;
}

export interface Article {
  headline: string;
  standfirst: string;
  byline: string;
  body: string[];
}

// Strip ASCII control chars (keep normal whitespace), collapse, trim.
function clean(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\u0000-\u001F\u007F]/g, "").trim();
}

const schema = z.object({
  brand: z.string().min(1).max(80),
  product: z.string().min(1).max(600),
  market: z.enum(MARKET_CODES),
  tone: z.enum(TONES),
});

export type ParseResult =
  | { ok: true; value: PreviewInput }
  | { ok: false; error: string };

export function parsePreviewInput(raw: unknown): ParseResult {
  const pre =
    raw && typeof raw === "object"
      ? {
          ...raw,
          brand: clean(String((raw as Record<string, unknown>).brand ?? "")),
          product: clean(String((raw as Record<string, unknown>).product ?? "")),
        }
      : raw;
  const parsed = schema.safeParse(pre);
  if (!parsed.success) return { ok: false, error: "invalid_input" };
  return { ok: true, value: parsed.data };
}

const MARKET_LANG: Record<MarketCode, "en" | "no" | "sv" | "da" | "de" | "fi"> = {
  NO: "no", SE: "sv", DK: "da", FI: "fi", DE: "de", AT: "de", CH: "de", UK: "en", IE: "en",
};

export function marketLanguage(code: MarketCode) {
  return MARKET_LANG[code];
}

const LANG_NAME: Record<ReturnType<typeof marketLanguage>, string> = {
  en: "English", no: "Norwegian", sv: "Swedish", da: "Danish", de: "German", fi: "Finnish",
};

export function marketLanguageName(code: MarketCode): string {
  return LANG_NAME[marketLanguage(code)];
}
