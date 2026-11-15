import crypto from "node:crypto";

// Bearer check for the scheduler endpoint. Returns:
//   "disabled"     — CRON_SECRET is not configured (endpoint is off),
//   "unauthorized" — header missing or wrong,
//   "ok"           — constant-time match.
export function checkCronAuth(
  authorization: string | null,
  secret: string | undefined = process.env.CRON_SECRET,
): "ok" | "unauthorized" | "disabled" {
  if (!secret || secret.length < 24) return "disabled";
  const m = /^Bearer\s+(.+)$/i.exec(authorization ?? "");
  if (!m) return "unauthorized";
  const a = crypto.createHash("sha256").update(m[1]).digest();
  const b = crypto.createHash("sha256").update(secret).digest();
  return crypto.timingSafeEqual(a, b) ? "ok" : "unauthorized";
}
