import { prisma } from "@/lib/prisma";
import { signIn } from "@/auth";
import { generateToken, hashToken, tokenExpiry } from "@/lib/tokens";

// Sign a just-created passwordless account in: mint a single-use
// magic-link token and consume it in-process via the magic-link
// provider. Redirecting through the GET consume route doesn't work
// from a server action — the action's own fetch follows the redirect
// and consumes the token server-side, so the browser's real
// navigation finds it already used and the session cookie never
// reaches the client.
export async function passwordlessSignIn(
  userId: string,
  requestedIp: string,
): Promise<void> {
  const raw = generateToken();
  await prisma.magicLinkToken.create({
    data: {
      userId,
      tokenHash: hashToken(raw),
      expiresAt: tokenExpiry(),
      requestedIp,
    },
  });
  await signIn("magic-link", { token: raw, redirect: false });
}
