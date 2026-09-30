-- "Mark: offers native" used to name its blueprint products
-- "<Title> — <ProductType enum>" (e.g. "Aftenposten — NATIVE_DISPLAY").
-- Product.name is copied into quote and invoice lines, so the raw enum
-- leaked onto buyer documents. New blueprint rows are named in words
-- (activation-blueprint.ts); this renames the existing ones the same way.
-- Only the exact generated suffix is touched — publisher/quote-supplied
-- names never end in a raw enum. Already-issued quote and invoice lines
-- keep their text: they are documents as sent.
--
-- Data-only; revert by swapping the pairs below.
UPDATE "Product" SET "name" = left("name", length("name") - length(' — NATIVE_ARTICLE')) || ' — Native article'
WHERE "name" LIKE '% — NATIVE\_ARTICLE';
UPDATE "Product" SET "name" = left("name", length("name") - length(' — ADVERTORIAL')) || ' — Advertorial'
WHERE "name" LIKE '% — ADVERTORIAL';
UPDATE "Product" SET "name" = left("name", length("name") - length(' — NATIVE_DISPLAY')) || ' — Native display'
WHERE "name" LIKE '% — NATIVE\_DISPLAY';
