export function normaliseEmail(s: string): string {
  return s.trim().toLowerCase();
}

export type ContactInput = {
  id: string;
  publisherId: string;
  email: string;
  name: string | null;
  titleIds: string[];
};

export type RecipientGroup = {
  recipientEmail: string;
  recipientName: string | null;
  titleIds: string[];           // deduped union across the group
  sourceContactIds: string[];
};

export function groupSalesContactsByEmail(
  contacts: ContactInput[],
  suppressed: Set<string> = new Set(),
): RecipientGroup[] {
  const byEmail = new Map<string, RecipientGroup>();
  for (const c of contacts) {
    const email = normaliseEmail(c.email);
    if (suppressed.has(email)) continue;
    let group = byEmail.get(email);
    if (!group) {
      group = {
        recipientEmail: email,
        recipientName: c.name,
        titleIds: [],
        sourceContactIds: [],
      };
      byEmail.set(email, group);
    }
    // Pick the longest non-null name.
    if (c.name && (!group.recipientName || c.name.length > group.recipientName.length)) {
      group.recipientName = c.name;
    }
    group.sourceContactIds.push(c.id);
    for (const t of c.titleIds) {
      if (!group.titleIds.includes(t)) group.titleIds.push(t);
    }
  }
  return Array.from(byEmail.values());
}
