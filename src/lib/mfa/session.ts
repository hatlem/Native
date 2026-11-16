import { AuthError, CredentialsSignin } from "next-auth";
import { signIn } from "@/auth";
import { prisma } from "@/lib/prisma";
import { SIGNIN_MFA_REQUIRED } from "@/lib/auth-errors";
import { mintSessionTicket } from "./tickets";

// Mint a session for `userId` at `sessionVersion` through the server-only
// ticket provider (src/auth.ts "session-ticket"). Used to finish a two-factor
// sign-in, and to keep the CURRENT browser signed in after an action bumped
// the session version (which deliberately ends every other session).
//
// Only call this for a user the current request has fully authenticated:
// the ticket IS the authorisation.
export async function issueSession(userId: string, sessionVersion: number): Promise<boolean> {
  try {
    await signIn("session-ticket", {
      ticket: mintSessionTicket(userId, sessionVersion),
      redirect: false,
    });
    return true;
  } catch (error) {
    if (error instanceof AuthError) return false;
    throw error;
  }
}

/** Re-mint the session of an already-signed-in user at their current version. */
export async function reissueSessionFor(userId: string): Promise<boolean> {
  const row = await prisma.user.findUnique({
    where: { id: userId },
    select: { sessionVersion: true },
  });
  return row ? issueSession(userId, row.sessionVersion) : false;
}

/** The credentials provider's "password fine, second factor needed" refusal. */
export function isMfaRequiredError(error: unknown): boolean {
  return error instanceof CredentialsSignin && error.code === SIGNIN_MFA_REQUIRED;
}
