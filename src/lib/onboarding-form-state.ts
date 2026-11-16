// State the onboarding action returns to its form (useActionState): which
// fields failed, and what was typed, so the form re-renders in place with
// field-level errors instead of a generic banner after a redirect.

export type OnboardingState = {
  errors: { market?: true; phone?: true };
  values: { market: string; phone: string };
};

export const INITIAL_ONBOARDING_STATE: OnboardingState = {
  errors: {},
  values: { market: "", phone: "" },
};

// Phone validation is forgiving: international users type spaces, country
// prefixes and dashes. At least 6 digits, at most 32 characters.
export function normalisePhone(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

export function isValidPhone(raw: string): boolean {
  const digits = raw.match(/\d/g)?.length ?? 0;
  return raw.length <= 32 && digits >= 6;
}

export function validateOnboarding(
  input: { market: string; phone: string },
  marketCodes: readonly string[],
): OnboardingState["errors"] {
  const errors: OnboardingState["errors"] = {};
  if (!marketCodes.includes(input.market)) errors.market = true;
  // Phone is optional; when one is given it must still look like a number.
  if (input.phone !== "" && !isValidPhone(input.phone)) errors.phone = true;
  return errors;
}
