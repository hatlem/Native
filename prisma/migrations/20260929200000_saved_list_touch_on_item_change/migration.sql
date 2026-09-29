-- "Sist endret" on a plan must move when its LINES change (add, remove,
-- quantity, note, alternative, schedule, …), not only when the list row
-- itself is renamed. Item rows are written from many code paths (plan and
-- campaign actions, programme waves, rehoming, desk tools), so the bump
-- lives in the database where no writer can forget it. A line moved between
-- lists touches both.
CREATE OR REPLACE FUNCTION saved_list_touch_on_item_change() RETURNS trigger AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    UPDATE "SavedList" SET "updatedAt" = now() WHERE id = OLD."listId";
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') AND (TG_OP = 'INSERT' OR NEW."listId" IS DISTINCT FROM OLD."listId") THEN
    UPDATE "SavedList" SET "updatedAt" = now() WHERE id = NEW."listId";
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS saved_list_item_touch_list ON "SavedListItem";
CREATE TRIGGER saved_list_item_touch_list
  AFTER INSERT OR UPDATE OR DELETE ON "SavedListItem"
  FOR EACH ROW EXECUTE FUNCTION saved_list_touch_on_item_change();
