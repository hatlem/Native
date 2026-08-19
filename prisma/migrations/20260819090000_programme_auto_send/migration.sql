-- Opt-in auto-send for campaign programmes: when enabled, the background
-- sweep submits each due wave to the desk as a normal RFQ (the buyer still
-- approves the quote before anything is booked or charged).
ALTER TABLE "CampaignProgramme" ADD COLUMN "autoSendEnabled" BOOLEAN NOT NULL DEFAULT false;
