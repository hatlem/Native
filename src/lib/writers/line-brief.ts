// The per-line brief as the writer and the desk read it: each field once.
//
// ContentBrief.message is copied from the plan's goal, which is optional —
// the buyer's own brief for the request stands in when it is empty, so the
// reader still sees what the campaign is about. Orders placed before the plan
// form stopped posting its free text as the "audience" too carry that same
// text in ContentBrief.audience; printing it under both "Message" and
// "Audience" showed the whole brief twice. A display rule, not a data change:
// an audience that only repeats the message is dropped.

export type StoredLineBrief = {
  message: string | null;
  audience: string | null;
};

export type LineBrief = { message: string | null; audience: string | null };

// Whitespace-insensitive comparison: the stored copies differ only in how
// the form joined the timing sentence.
function normalise(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

export function lineBrief(brief: StoredLineBrief | null, requestBrief: string | null): LineBrief {
  const message = brief?.message?.trim() || requestBrief?.trim() || null;
  const audience = brief?.audience?.trim() || null;
  if (!audience || !message) return { message, audience };
  const a = normalise(audience);
  const m = normalise(message);
  // Equal, or one wholly contains the other (the audience copy carried the
  // brief plus the timing sentence, or the brief plus nothing else).
  if (a === m || m.includes(a) || a.includes(m)) {
    return { message: a.length > m.length ? audience : message, audience: null };
  }
  return { message, audience };
}
