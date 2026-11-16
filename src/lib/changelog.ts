// Customer-facing changelog, newest first. Copy lives in the `changelog.entries`
// namespace of src/messages/<locale>.json (key = `id`), so every entry ships in
// all six languages. Add an entry here + its messages when a change affects
// how customers work.

export type ChangelogEntry = { id: string; date: string };

export const CHANGELOG: readonly ChangelogEntry[] = [
  { id: "selfService", date: "2026-11-15" },
  { id: "notificationPrefs", date: "2026-11-15" },
  { id: "help", date: "2026-11-15" },
];
