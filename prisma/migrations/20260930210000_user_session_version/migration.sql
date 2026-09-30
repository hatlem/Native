-- Server-side session revocation for stateless JWT sessions. Every JWT
-- carries the sessionVersion it was minted under (claim `sv`); the jwt
-- callback in src/auth.ts rejects a token whose claim no longer matches the
-- row. Bumping the column (password reset, password change) therefore ends
-- every session that existed before the bump.
--
-- Additive: tokens minted before this deploy carry no claim, which the
-- callback reads as 0, so the default keeps every live session valid.
-- Reverse with: ALTER TABLE "User" DROP COLUMN "sessionVersion";
ALTER TABLE "User" ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 0;
