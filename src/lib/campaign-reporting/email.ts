export type MetricsLocale = "en" | "no" | "sv" | "da" | "fi" | "de";
export type MetricsStep = "initial" | "bump1" | "bump2";

export type MetricsEmailArgs = {
  step: MetricsStep;
  locale: MetricsLocale;
  recipientName: string | null;
  publisherName: string;
  placementCount: number;
  link: string;
  token: string;
};
export type Built = { subject: string; text: string };

export function buildMetricsEmail(a: MetricsEmailArgs): Built {
  const hi = a.recipientName ? `Hi ${a.recipientName},` : "Hi,";
  const n = a.placementCount;
  const placements = n === 1 ? "the placement" : `your ${n} placements`;
  const subjectBase = `Campaign results for ${a.publisherName}`;
  const subject =
    a.step === "initial" ? subjectBase :
    a.step === "bump1" ? `Reminder: ${subjectBase}` :
    `Final reminder: ${subjectBase}`;
  const text = [
    hi,
    "",
    `The campaign that ran on ${a.publisherName} has ended. To close the loop with the advertiser, could you share the performance numbers for ${placements}?`,
    "",
    `Report them here (takes a minute): ${a.link}`,
    "",
    "You can also just reply to this email with the figures and we'll record them.",
    "",
    `[ref: ${a.token}]`,
    "",
    "Thank you,",
    "NativeSpin",
  ].join("\n");
  return { subject, text };
}
