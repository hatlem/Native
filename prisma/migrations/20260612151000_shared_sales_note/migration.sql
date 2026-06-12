-- User assessment: iHarstad + Arbeidets Rett = shared arrangement
-- (Amedia-owned, sold via the Polaris sales network). Replace the
-- "verify" flag with that explanation so the desk isn't chasing it.
UPDATE "Title" SET "outstandingInfo" = array_replace("outstandingInfo",
  'Verifiser salgshus: Polaris-prisede produkter, men Amedia-eid iflg. amedia.no/aviser',
  'Delt ansvar: Amedia-eid (amedia.no), selges via Polaris-nettverket — Polaris-priser gjelder')
WHERE slug IN ('iharstad-no','arbeidets-rett-no');
