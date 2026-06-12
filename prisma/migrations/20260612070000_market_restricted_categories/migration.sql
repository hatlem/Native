ALTER TABLE "Market" ADD COLUMN "restrictedCategories" TEXT[] NOT NULL DEFAULT '{}';

-- Regulatory floor per market (display-only; enforcement lives in the
-- brief flow). Sources: NO lotteriloven/alkoholloven/tobakksskadeloven;
-- SE spellag (licensed only) + alkohollag; DK/FI/DE/AT/CH/UK/IE national
-- marketing acts. Conservative starting set — desk can refine.
UPDATE "Market" SET "restrictedCategories" = '{GAMBLING,ALCOHOL,TOBACCO,PRESCRIPTION_DRUGS}' WHERE code = 'NO';
UPDATE "Market" SET "restrictedCategories" = '{ALCOHOL,TOBACCO,PRESCRIPTION_DRUGS}' WHERE code IN ('SE','FI');
UPDATE "Market" SET "restrictedCategories" = '{TOBACCO,PRESCRIPTION_DRUGS}' WHERE code IN ('DK','DE','AT','CH','UK','IE','NL','BE');
