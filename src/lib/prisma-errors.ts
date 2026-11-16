// Prisma's unique-constraint violation (P2002). Checked structurally rather
// than with instanceof so it also matches errors that crossed a module
// boundary (mocked clients in tests, duplicated client bundles).
export function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: unknown }).code === "P2002"
  );
}
