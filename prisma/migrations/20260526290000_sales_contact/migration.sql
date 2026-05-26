-- SalesContact: named contacts at a publisher who are involved in
-- selling / managing native placements. Linked to Publisher 1-to-many.
-- SalesContactTitle: join table connecting contacts to specific titles,
-- with an isPrimary flag so callers can identify the lead contact per
-- title without a full scan.

CREATE TABLE "SalesContact" (
  "id"          TEXT        NOT NULL,
  "publisherId" TEXT        NOT NULL,
  "name"        TEXT        NOT NULL,
  "email"       TEXT        NOT NULL,
  "phone"       TEXT,
  "role"        TEXT,
  "notes"       TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SalesContact_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SalesContact_publisherId_email_key"
  ON "SalesContact"("publisherId", "email");

CREATE INDEX "SalesContact_publisherId_idx"
  ON "SalesContact"("publisherId");

ALTER TABLE "SalesContact"
  ADD CONSTRAINT "SalesContact_publisherId_fkey"
  FOREIGN KEY ("publisherId") REFERENCES "Publisher"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "SalesContactTitle" (
  "salesContactId" TEXT        NOT NULL,
  "titleId"        TEXT        NOT NULL,
  "isPrimary"      BOOLEAN     NOT NULL DEFAULT false,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SalesContactTitle_pkey" PRIMARY KEY ("salesContactId", "titleId")
);

CREATE INDEX "SalesContactTitle_titleId_idx"
  ON "SalesContactTitle"("titleId");

ALTER TABLE "SalesContactTitle"
  ADD CONSTRAINT "SalesContactTitle_salesContactId_fkey"
  FOREIGN KEY ("salesContactId") REFERENCES "SalesContact"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SalesContactTitle"
  ADD CONSTRAINT "SalesContactTitle_titleId_fkey"
  FOREIGN KEY ("titleId") REFERENCES "Title"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- One primary sales contact per title (partial unique index, enforced at DB).
CREATE UNIQUE INDEX "SalesContactTitle_one_primary_per_title"
  ON "SalesContactTitle"("titleId") WHERE "isPrimary" = true;
