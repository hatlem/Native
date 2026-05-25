-- Publisher invite — super-admin sends a tokenised link to a new
-- publisher commercial lead so they can claim a portal account that's
-- pre-bound to the Publisher row created during catalog activation.
--
-- Closes Ingrid's scenario gap (no sendPublisherInvite action; manual
-- email drafting was the workaround).

CREATE TABLE IF NOT EXISTS "PublisherInvite" (
  "id" TEXT NOT NULL,
  "publisherId" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "token" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "claimedAt" TIMESTAMP(3),
  "claimedByUserId" TEXT,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PublisherInvite_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PublisherInvite_token_key" ON "PublisherInvite"("token");
CREATE INDEX IF NOT EXISTS "PublisherInvite_publisherId_idx" ON "PublisherInvite"("publisherId");
CREATE INDEX IF NOT EXISTS "PublisherInvite_email_idx" ON "PublisherInvite"("email");

ALTER TABLE "PublisherInvite"
  ADD CONSTRAINT "PublisherInvite_publisherId_fkey"
  FOREIGN KEY ("publisherId") REFERENCES "Publisher"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
