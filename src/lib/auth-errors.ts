// `code` the credentials provider (src/auth.ts) puts on the CredentialsSignin
// it throws when the sign-in limiter trips. Lives outside src/auth.ts so the
// "use server" sign-in action can import it without pulling in a non-async
// export, and so both sides agree on one string.
export const SIGNIN_RATE_LIMITED = "rate_limited";
