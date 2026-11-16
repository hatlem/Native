import bcrypt from "bcryptjs";

// One cost factor for every password hash the app writes. bcrypt.compare
// reads the cost from the stored hash, so existing cost-10 hashes keep
// verifying; they are upgraded the next time the user sets a password.
export const BCRYPT_COST = 12;

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_COST);
}
