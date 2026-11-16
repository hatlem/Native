// The processors evident from the codebase, for the public /subprocessors
// page. `location` is null where the code does not determine the processing
// region (shown as "to be confirmed" until the owner confirms it from the
// vendor contract). `optional` marks integrations that only run when their
// env configuration is present.

export const SUBPROCESSORS_LAST_UPDATED = "2026-11-15";

export type Subprocessor = {
  // Message key under `subprocessors.<key>.{purpose,data}`.
  key: "railway" | "resend" | "r2" | "ai" | "gtm" | "getcookies" | "fiken";
  // Vendor name, or null when the name itself is a translated description.
  name: string | null;
  location: string | null;
  optional: boolean;
};

export const SUBPROCESSORS: readonly Subprocessor[] = [
  { key: "railway", name: "Railway", location: null, optional: false },
  { key: "resend", name: "Resend", location: null, optional: false },
  { key: "r2", name: "Cloudflare R2", location: null, optional: false },
  { key: "ai", name: null, location: null, optional: true },
  { key: "gtm", name: "Google Tag Manager", location: null, optional: true },
  { key: "getcookies", name: "GetCookies", location: null, optional: true },
  { key: "fiken", name: "Fiken", location: null, optional: true },
];
