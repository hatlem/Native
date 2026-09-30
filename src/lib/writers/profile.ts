// Writer profile form: validation + the state the profile form renders.
// Pure (no DB, no "use server") so it can be unit-tested and shared by the
// server action and the client form.

import { z } from "zod";
import { ContentLanguage, ContentTopic, LanguageProficiency } from "@prisma/client";

export const PROFILE_CURRENCIES = ["NOK", "SEK", "DKK", "EUR", "GBP", "CHF"] as const;
export const MAX_ACTIVE_ASSIGNMENTS_LIMIT = 50;
const MAX_RATE_PER_ARTICLE = 1_000_000;
const MAX_RATE_PER_WORD = 1_000;

export type ProfileField =
  | "bio"
  | "languages"
  | "ratePerArticle"
  | "ratePerWord"
  | "currency"
  | "maxActiveAssignments"
  | "portfolioUrl";

// The form's field values as strings — what the inputs show. An error
// state carries the submitted values back so the writer's input survives
// React's post-action form reset instead of snapping back to the saved
// profile.
export type ProfileFormValues = {
  bio: string;
  languages: Partial<Record<ContentLanguage, string>>;
  specialties: string[];
  ratePerArticle: string;
  ratePerWord: string;
  currency: string;
  maxActiveAssignments: string;
  portfolioUrl: string;
  active: boolean;
};

export type WriterProfileState =
  | { status: "idle" }
  | { status: "saved" }
  | { status: "error"; fields: ProfileField[]; values: ProfileFormValues };

export const WRITER_PROFILE_IDLE: WriterProfileState = { status: "idle" };

// "4 500", "4500,50" and "4500.5" all mean what a Nordic writer typed.
function parseAmount(raw: string): number | null | "invalid" {
  const cleaned = raw.replace(/[\s ]/g, "").replace(",", ".");
  if (cleaned === "") return null;
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return "invalid";
  return Number(cleaned);
}

const optionalAmount = (max: number) =>
  z
    .string()
    .transform((raw, ctx) => {
      const n = parseAmount(raw);
      if (n === "invalid" || (n !== null && (n <= 0 || n > max))) {
        ctx.addIssue({ code: "custom", message: "invalid" });
        return z.NEVER;
      }
      return n;
    });

const schema = z.object({
  bio: z.string().trim().max(2000),
  languages: z
    .array(
      z.object({
        language: z.enum(ContentLanguage),
        proficiency: z.enum(LanguageProficiency),
      }),
    )
    .min(1),
  specialties: z.array(z.enum(ContentTopic)),
  ratePerArticle: optionalAmount(MAX_RATE_PER_ARTICLE),
  ratePerWord: optionalAmount(MAX_RATE_PER_WORD),
  currency: z.union([z.literal(""), z.enum(PROFILE_CURRENCIES)]),
  maxActiveAssignments: z
    .string()
    .trim()
    .transform((raw, ctx) => {
      if (raw === "") return null;
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 1 || n > MAX_ACTIVE_ASSIGNMENTS_LIMIT) {
        ctx.addIssue({ code: "custom", message: "invalid" });
        return z.NEVER;
      }
      return n;
    }),
  portfolioUrl: z
    .string()
    .trim()
    .refine((v) => v === "" || /^https?:\/\/[^\s]+\.[^\s]+/i.test(v), "invalid")
    .transform((v) => (v === "" ? null : v)),
  active: z.boolean(),
})
  // A rate without a currency is meaningless to the desk comparing writers.
  .refine(
    (d) => (d.ratePerArticle === null && d.ratePerWord === null) || d.currency !== "",
    { path: ["currency"], message: "required" },
  );

export type WriterProfileInput = {
  bio: string | null;
  languages: { language: ContentLanguage; proficiency: LanguageProficiency }[];
  specialties: ContentTopic[];
  ratePerArticle: number | null;
  ratePerWord: number | null;
  currency: string | null;
  maxActiveAssignments: number | null;
  portfolioUrl: string | null;
  active: boolean;
};

function str(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v : "";
}

export function submittedProfileValues(formData: FormData): ProfileFormValues {
  return {
    bio: str(formData, "bio"),
    languages: Object.fromEntries(
      Object.values(ContentLanguage).map((l) => [l, str(formData, `lang_${l}`)]),
    ),
    specialties: formData.getAll("specialties").filter((v): v is string => typeof v === "string"),
    ratePerArticle: str(formData, "ratePerArticle"),
    ratePerWord: str(formData, "ratePerWord"),
    currency: str(formData, "currency"),
    maxActiveAssignments: str(formData, "maxActiveAssignments"),
    portfolioUrl: str(formData, "portfolioUrl"),
    active: str(formData, "active") === "on",
  };
}

// Languages arrive as one select per language (`lang_NO` = "NATIVE" | ""),
// so every language carries its own proficiency — a single shared select
// used to silently downgrade every language to its default on re-save.
export function parseWriterProfileForm(
  formData: FormData,
): { ok: true; data: WriterProfileInput } | { ok: false; fields: ProfileField[] } {
  const languages = Object.values(ContentLanguage)
    .map((language) => ({ language, proficiency: str(formData, `lang_${language}`) }))
    .filter((l) => l.proficiency !== "");

  const parsed = schema.safeParse({
    bio: str(formData, "bio"),
    languages,
    specialties: formData.getAll("specialties").filter((v) => typeof v === "string"),
    ratePerArticle: str(formData, "ratePerArticle"),
    ratePerWord: str(formData, "ratePerWord"),
    currency: str(formData, "currency"),
    maxActiveAssignments: str(formData, "maxActiveAssignments"),
    portfolioUrl: str(formData, "portfolioUrl"),
    active: str(formData, "active") === "on",
  });
  if (!parsed.success) {
    const fields = new Set<ProfileField>();
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if (key === "specialties" || key === "active") continue; // can't be invalid from the form
      fields.add(key as ProfileField);
    }
    return { ok: false, fields: [...fields] };
  }
  const d = parsed.data;
  return {
    ok: true,
    data: {
      bio: d.bio || null,
      languages: d.languages,
      specialties: [...new Set(d.specialties)],
      ratePerArticle: d.ratePerArticle,
      ratePerWord: d.ratePerWord,
      currency: d.currency || null,
      maxActiveAssignments: d.maxActiveAssignments,
      portfolioUrl: d.portfolioUrl,
      active: d.active,
    },
  };
}
