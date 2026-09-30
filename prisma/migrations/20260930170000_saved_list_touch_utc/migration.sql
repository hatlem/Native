-- "updatedAt" is timestamp WITHOUT time zone holding UTC (Prisma's convention),
-- but now() renders in the session's TimeZone. Prod runs Etc/UTC so it was
-- right there by accident; any non-UTC session (a local Europe/Oslo DB, a
-- future config change) stamped lists hours into the future ("sist endret
-- dette minuttet" forever). Pin the value to UTC explicitly.
CREATE OR REPLACE FUNCTION saved_list_touch_on_item_change() RETURNS trigger AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    UPDATE "SavedList" SET "updatedAt" = (now() AT TIME ZONE 'UTC') WHERE id = OLD."listId";
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') AND (TG_OP = 'INSERT' OR NEW."listId" IS DISTINCT FROM OLD."listId") THEN
    UPDATE "SavedList" SET "updatedAt" = (now() AT TIME ZONE 'UTC') WHERE id = NEW."listId";
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
