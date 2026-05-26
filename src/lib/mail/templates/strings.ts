// Locale-keyed copy for the five auth emails. Co-located with the
// templates because they're tied to the email layout, not the UI
// translation surface. If you add a sixth email, add its strings here.

export type Locale = "en" | "no" | "sv" | "da" | "de" | "fi";

type EmailStrings = {
  magicLink: {
    subject: (app: string) => string;
    preheader: string;
    heading: string;
    body: string;
    cta: string;
    footer: string;
  };
  passwordReset: {
    subject: (app: string) => string;
    preheader: string;
    heading: string;
    body: string;
    cta: string;
    footer: string;
  };
  welcome: {
    subject: (app: string) => string;
    preheader: string;
    heading: string;
    body: (app: string) => string;
    cta: string;
    footer: string;
  };
  passwordChanged: {
    subject: (app: string) => string;
    preheader: string;
    heading: string;
    body: (ip: string, at: string) => string;
    footer: string;
  };
  newSigninAlert: {
    subject: (app: string) => string;
    preheader: string;
    heading: string;
    body: (ip: string, at: string) => string;
    cta: string;
    footer: string;
  };
};

const en: EmailStrings = {
  magicLink: {
    subject: (app) => `Sign in to ${app}`,
    preheader: "Your sign-in link is ready.",
    heading: "Sign in",
    body: "Click the button below to sign in. This link is valid for 15 minutes and can only be used once.",
    cta: "Sign in",
    footer: "If you didn't request this, you can safely ignore this email.",
  },
  passwordReset: {
    subject: (app) => `Reset your ${app} password`,
    preheader: "Reset your password.",
    heading: "Reset your password",
    body: "Click the button below to set a new password. This link is valid for 15 minutes and can only be used once.",
    cta: "Reset password",
    footer: "If you didn't request this, you can safely ignore this email — your password won't change.",
  },
  welcome: {
    subject: (app) => `Welcome to ${app}`,
    preheader: "Your account is ready.",
    heading: "Welcome",
    body: (app) => `Your ${app} account is ready. Browse the catalog whenever you want, and submit a brief whenever you're ready to buy.`,
    cta: "Browse the catalog",
    footer: "Need help? Just reply to this email.",
  },
  passwordChanged: {
    subject: (app) => `Your ${app} password was changed`,
    preheader: "Password updated.",
    heading: "Password changed",
    body: (ip, at) => `Your password was changed on ${at} (IP ${ip}). If this wasn't you, reply to this email immediately.`,
    footer: "For your security, we email every password change.",
  },
  newSigninAlert: {
    subject: (app) => `New sign-in to your ${app} account`,
    preheader: "A new device signed in.",
    heading: "New sign-in detected",
    body: (ip, at) => `A new sign-in to your account was detected on ${at} (IP ${ip}). If this was you, no action is needed.`,
    cta: "Reset password",
    footer: "If you don't recognise this, reset your password using the button above.",
  },
};

// Stub all other locales as English for now. Translate before launch —
// task notes call out where. Keys must match `en` exactly.
const no: EmailStrings = en;
const sv: EmailStrings = en;
const da: EmailStrings = en;
const de: EmailStrings = en;
const fi: EmailStrings = en;

const TABLE: Record<Locale, EmailStrings> = { en, no, sv, da, de, fi };

export function strings(locale: string): EmailStrings {
  return TABLE[(locale as Locale)] ?? en;
}
