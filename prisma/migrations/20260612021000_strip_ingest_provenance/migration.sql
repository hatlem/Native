-- Ingest provenance ("annonseweb.adressa.no/products/2780 – native") was
-- written into product descriptions as source citations and leaked into
-- the buyer-facing card when descriptions became visible. Strip the
-- fragments; keep the human part of the description.
UPDATE "Product"
SET "description" = NULLIF(
  btrim(
    regexp_replace("description", '\s*annonseweb\.adressa\.no\S*(\s*[–-]\s*[a-zA-Z-]+)?\.?', '', 'g'),
    ' .'
  ),
  ''
)
WHERE "description" ILIKE '%annonseweb%';
