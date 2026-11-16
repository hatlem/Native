// State returned by the sign-up server action to its form (useActionState).
// Validation failures come back here — field values included — instead of a
// redirect to /signup?error=…&name=…&email=…, which put the person's name,
// organisation and email address into the URL, browser history and logs.

export type SignupField = "orgName" | "email" | "password";

export type SignupState = {
  // Error code as emitted by the action (matches the old ?error= codes).
  error: string | null;
  values: { name: string; orgName: string; email: string };
  // Set with error "email_typo": the address we think they meant.
  typoSuggestion: string | null;
  typedDomain: string | null;
};

export const INITIAL_SIGNUP_STATE: SignupState = {
  error: null,
  values: { name: "", orgName: "", email: "" },
  typoSuggestion: null,
  typedDomain: null,
};

/** Which field an error belongs to; null = a form-level problem (rate limit, generic). */
export function signupErrorField(
  error: string | null,
  values: { orgName: string; email: string },
): SignupField | null {
  switch (error) {
    case "email_business":
    case "email_invalid":
    case "email_domain":
    case "email_typo":
      return "email";
    case "password_length":
      return "password";
    case "1":
      // Missing required input: point at the first empty required field.
      if (!values.orgName) return "orgName";
      if (!values.email) return "email";
      return null;
    default:
      return null;
  }
}

/** auth.* message key for an error code; null for the typo prompt (it has its own UI). */
export function signupErrorMessageKey(error: string | null, field: SignupField | null): string | null {
  switch (error) {
    case null:
    case "email_typo":
      return null;
    case "rate":
      return "regRateLimited";
    case "email_business":
      return "regEmailBusiness";
    case "email_invalid":
      return "regEmailInvalid";
    case "email_domain":
      return "regEmailNoMailServer";
    case "password_length":
      return "regPasswordTooShort";
    case "1":
      return field === "orgName" ? "regOrgRequired" : field === "email" ? "regEmailRequired" : "regFailed";
    default:
      return "regFailed";
  }
}
