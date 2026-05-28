export type SequenceStep = "initial" | "bump1" | "bump2";
export const MAX_STEPS = 3;

const DAYS_AFTER: Record<SequenceStep, number | null> = {
  initial: 5,
  bump1: 7,
  bump2: null, // terminal
};

export function stepKindForCount(sentCount: number): SequenceStep {
  if (sentCount === 0) return "initial";
  if (sentCount === 1) return "bump1";
  if (sentCount === 2) return "bump2";
  throw new Error("max_steps_exceeded");
}

export function nextStepDate(currentStep: SequenceStep, now: Date = new Date()): Date | null {
  const days = DAYS_AFTER[currentStep];
  if (days === null) return null;
  const d = new Date(now);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

export function isSequenceTerminal(sentCount: number): boolean {
  return sentCount >= MAX_STEPS;
}
